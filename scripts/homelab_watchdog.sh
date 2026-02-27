#!/bin/bash
set -euo pipefail

# --------------------------------------------------
# HomeLab WatchDog Script - Complete Self-Healing Solution
# --------------------------------------------------
# Multi-level health monitoring with graduated response
# Prevents simultaneous execution with proper locking
# Checks: mount integrity, internet, BetterStack, UptimeKuma, Docker, Tailscale
# --------------------------------------------------

# Configuration
readonly SCRIPT_NAME="homelab_watchdog"
readonly LOCK_FILE="/var/run/${SCRIPT_NAME}.lock"
readonly STATE_DIR="/var/lib/${SCRIPT_NAME}"
readonly STATE_FILE="${STATE_DIR}/state"
readonly LOG_FILE="/var/log/${SCRIPT_NAME}.log"
readonly QUEUE_FILE="${STATE_DIR}/ntfy_queue"
readonly CREDS_FILE="/root/.homelab-watchdog-credentials"

# Network and service configuration
readonly HOMELAB_DIR="/home/jkrumm/homelab"
readonly HDD_MOUNT_POINT="/mnt/hdd"
readonly TAILSCALE_RESTART_WAIT=30
readonly TAILSCALE_FAILURE_FILE="${STATE_DIR}/tailscale_failing"

# Timeouts and intervals (in seconds)
readonly HEALTH_CHECK_TIMEOUT=30
readonly DOCKER_RESTART_WAIT=120
readonly DOCKER_COMPOSE_STABILIZE_WAIT=60  # Time for containers to fully start
readonly INTERNET_CHECK_TIMEOUT=20
readonly INTERNET_RECOVERY_WAIT=600  # Wait 10 minutes for internet to recover naturally
readonly NETWORK_STABILIZE_WAIT=60  # Extended time for network to stabilize
readonly EXTERNAL_MONITOR_PATIENCE_WAIT=420  # 7 minutes - wait for BetterStack to update (was 260)
readonly EXTERNAL_MONITOR_RECHECK_ATTEMPTS=3  # How many times to recheck BetterStack
readonly RECOVERY_VERIFICATION_RETRIES=3
readonly RECOVERY_VERIFICATION_INTERVAL=30
readonly MOUNT_RETRY_ATTEMPTS=3
readonly MOUNT_RETRY_INTERVAL=30
# Reboot protection
readonly MAX_REBOOTS_PER_DAY=3
readonly REBOOT_TRACKING_FILE="${STATE_DIR}/reboot_tracker"
readonly MANUAL_INTERVENTION_FLAG="${STATE_DIR}/manual_intervention_required"

# Create directories with proper permissions
mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$LOG_FILE")"
touch "$LOG_FILE" "$QUEUE_FILE"

# --------------------------------------------------
# Locking mechanism - prevents simultaneous execution
# --------------------------------------------------
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') Script already running, exiting" | tee -a "$LOG_FILE"
    exit 1
fi

# Trap to ensure cleanup on exit
trap 'flock -u 200' EXIT

# --------------------------------------------------
# Load and validate credentials
# --------------------------------------------------
# Secure credential storage (readonly, not exported to child processes)
declare -g _CRED_BETTERSTACK=""
declare -g _CRED_NTFY_TOKEN=""
declare -g _CRED_UPTIME_KUMA=""

load_credentials() {
    if [[ ! -f "$CREDS_FILE" ]]; then
        log "ERROR: Credentials file missing: $CREDS_FILE"
        exit 1
    fi

    # Check file permissions (should be 600)
    local perms
    perms=$(stat -c "%a" "$CREDS_FILE")
    if [[ "$perms" != "600" ]]; then
        log "WARNING: Credentials file has incorrect permissions: $perms (should be 600)"
    fi

    # shellcheck source=/dev/null
    source "$CREDS_FILE"

    # Validate required variables (Fritz credentials removed - not at our location)
    local required_vars=("BETTERSTACK_TOKEN" "NTFY_TOKEN")
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            log "ERROR: Missing required variable: $var"
            exit 1
        fi
    done

    # Copy to internal variables (not exported, reduces /proc/environ exposure)
    _CRED_BETTERSTACK="$BETTERSTACK_TOKEN"
    _CRED_NTFY_TOKEN="$NTFY_TOKEN"
    _CRED_UPTIME_KUMA="${UPTIME_KUMA_PUSH_TOKEN:-}"

    # Unset original sourced variables to reduce environment exposure
    unset BETTERSTACK_TOKEN NTFY_TOKEN UPTIME_KUMA_PUSH_TOKEN
}

# --------------------------------------------------
# Utility functions
# --------------------------------------------------
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG_FILE"
}

log_quiet() {
    # Only logs to file, not to stdout (for success cases)
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

notify() {
    local title="$1"
    local msg="$2"
    echo "title=$title&message=$msg" >> "$QUEUE_FILE"
    log "QUEUED NOTIFICATION: $title - $msg"
}

flush_notifications() {
    if [[ ! -s "$QUEUE_FILE" ]]; then
        return 0
    fi

    local msgs
    msgs=$(awk -F'&message=' '{print $2}' "$QUEUE_FILE" | tr '\n' '\n• ')

    if curl -s --max-time 10 \
           -H "Authorization: Bearer $_CRED_NTFY_TOKEN" \
           -H "Title: HomeLab WatchDog" \
           -d "• $msgs" \
           "http://localhost:8093/homelab-watchdog" > /dev/null 2>&1; then
        > "$QUEUE_FILE"  # Clear queue on success
        log_quiet "Notifications sent successfully"
    else
        log "Failed to send notifications, keeping in queue"
    fi
}

send_uptime_kuma_heartbeat() {
    # Optional: Send heartbeat to Uptime Kuma push monitor
    # Skip silently if token not configured (allows incremental deployment)
    if [[ -z "${_CRED_UPTIME_KUMA:-}" ]]; then
        return 0
    fi

    local state
    state=$(get_current_state)
    local msg="state=$state"

    if curl -s --max-time 10 "http://localhost:3010/api/push/${_CRED_UPTIME_KUMA}?status=up&msg=${msg}&ping=" > /dev/null 2>&1; then
        log_quiet "Uptime Kuma heartbeat sent (state=$state)"
    else
        log "Failed to send Uptime Kuma heartbeat"
    fi
}

get_current_state() {
    if [[ -f "$STATE_FILE" && -s "$STATE_FILE" ]]; then
        local state
        state=$(cat "$STATE_FILE")
        # Validate that state is a number
        if [[ "$state" =~ ^[0-4]$ ]]; then
            echo "$state"
        else
            echo "0"
        fi
    else
        echo "0"
    fi
}

set_state() {
    echo "$1" > "$STATE_FILE"
    log "State changed to: $1"
}

# --------------------------------------------------
# Health check functions
# --------------------------------------------------
check_internet_connectivity() {
    local verbose="${1:-true}"

    if [[ "$verbose" == "true" ]]; then
        log_quiet "Checking internet connectivity..."
    fi

    # Try multiple DNS servers
    local dns_servers=("8.8.8.8" "1.1.1.1" "9.9.9.9")

    for dns in "${dns_servers[@]}"; do
        if timeout "$INTERNET_CHECK_TIMEOUT" ping -c 1 "$dns" &>/dev/null; then
            return 0
        fi
    done

    # Try DNS resolution as fallback
    if timeout "$INTERNET_CHECK_TIMEOUT" nslookup google.com &>/dev/null; then
        return 0
    fi

    return 1
}

check_external_monitor() {
    local wait_for_recovery="${1:-false}"
    local verbose="${2:-true}"  # Add verbose parameter

    if [[ "$verbose" == "true" ]]; then
        log_quiet "Checking external monitor (BetterStack)..."
    fi

    # Helper function to check BetterStack status
    check_betterstack_status() {
        local resp
        if ! resp=$(timeout "$HEALTH_CHECK_TIMEOUT" curl -s \
                    -H "Authorization: Bearer $_CRED_BETTERSTACK" \
                    https://uptime.betterstack.com/api/v2/monitors/3001641 2>/dev/null); then
            return 1
        fi

        # Parse JSON response
        if command -v jq &>/dev/null; then
            if echo "$resp" | jq -e '.data.attributes.status == "up"' &>/dev/null; then
                return 0
            fi
        else
            # Fallback to grep if jq not available
            if echo "$resp" | grep -q '"status":"up"'; then
                return 0
            fi
        fi
        return 1
    }

    # First attempt
    if check_betterstack_status; then
        return 0
    fi

    # First attempt failed - retry with exponential backoff before escalating
    if [[ "$wait_for_recovery" == "false" ]]; then
        # Initial check failed - do 2 more retries with exponential backoff
        local retry_delays=(5 10)  # Short delays: 5s, then 10s
        local retry_attempt=1

        for delay in "${retry_delays[@]}"; do
            if [[ "$verbose" == "true" ]]; then
                log "BetterStack check failed - retry $retry_attempt/${#retry_delays[@]} after ${delay}s..."
            fi
            sleep "$delay"

            if check_betterstack_status; then
                if [[ "$verbose" == "true" ]]; then
                    log "✅ BetterStack: UP (recovered on retry $retry_attempt)"
                fi
                return 0
            fi
            ((retry_attempt++))
        done

        # All retries failed
        if [[ "$verbose" == "true" ]]; then
            log "⚠️ BetterStack still down after ${#retry_delays[@]} retries"
        fi
        return 1
    fi

    # If we're checking after recovery, be more patient
    if [[ "$wait_for_recovery" == "true" ]]; then
        log "BetterStack reports down - waiting for monitor to detect recovery..."
        log "Note: BetterStack may take several minutes to detect changes"

        # Multiple recheck attempts with increasing patience
        local attempt=1
        while [[ $attempt -le $EXTERNAL_MONITOR_RECHECK_ATTEMPTS ]]; do
            log "Patience attempt $attempt/$EXTERNAL_MONITOR_RECHECK_ATTEMPTS - waiting ${EXTERNAL_MONITOR_PATIENCE_WAIT}s..."
            sleep "$EXTERNAL_MONITOR_PATIENCE_WAIT"

            log "Re-checking external monitor..."
            if check_betterstack_status; then
                log "✅ BetterStack reports: UP (recovered after ${attempt} patience period(s))"
                return 0
            fi

            log "BetterStack still reports down after patience period $attempt"
            ((attempt++))
        done

        log "⚠️ BetterStack still reports down after $EXTERNAL_MONITOR_RECHECK_ATTEMPTS attempts (${EXTERNAL_MONITOR_PATIENCE_WAIT}s each)"
    fi

    return 1
}

check_internal_monitor() {
    local verbose="${1:-true}"  # Add verbose parameter

    if [[ "$verbose" == "true" ]]; then
        log_quiet "Checking internal monitor (UptimeKuma)..."
    fi

    # Helper function to check UptimeKuma status
    check_uptimekuma_status() {
        local resp
        if ! resp=$(timeout "$HEALTH_CHECK_TIMEOUT" curl -s \
                    http://localhost:3010/api/status-page/homelab-watchdog 2>/dev/null); then
            return 1
        fi

        # Check if we got a valid JSON response
        if ! echo "$resp" | grep -q '"config".*"incidents"'; then
            return 1
        fi

        # Parse JSON response - check for incidents and maintenance
        if command -v jq &>/dev/null; then
            # Use jq for proper JSON parsing
            local incidents_count maintenance_count
            incidents_count=$(echo "$resp" | jq -r '.incidents | length')
            maintenance_count=$(echo "$resp" | jq -r '.maintenanceList | length')

            if [[ "$incidents_count" == "0" && "$maintenance_count" == "0" ]]; then
                return 0
            else
                if [[ "$incidents_count" != "0" ]]; then
                    log "UptimeKuma reports: INCIDENT DETECTED ($incidents_count active)"
                fi
                if [[ "$maintenance_count" != "0" ]]; then
                    log "UptimeKuma reports: MAINTENANCE ACTIVE ($maintenance_count items)"
                fi
                return 1
            fi
        else
            # Fallback to grep if jq not available
            if echo "$resp" | grep -q '"incidents":\[\]' && echo "$resp" | grep -q '"maintenanceList":\[\]'; then
                return 0
            else
                # Check what's wrong
                if echo "$resp" | grep -vq '"incidents":\[\]'; then
                    log "UptimeKuma reports: INCIDENT DETECTED"
                fi
                if echo "$resp" | grep -vq '"maintenanceList":\[\]'; then
                    log "UptimeKuma reports: MAINTENANCE ACTIVE"
                fi
                return 1
            fi
        fi
    }

    # First attempt
    if check_uptimekuma_status; then
        return 0
    fi

    # First attempt failed - retry with exponential backoff
    local retry_delays=(5 10)  # Short delays: 5s, then 10s
    local retry_attempt=1

    for delay in "${retry_delays[@]}"; do
        if [[ "$verbose" == "true" ]]; then
            log "UptimeKuma check failed - retry $retry_attempt/${#retry_delays[@]} after ${delay}s..."
        fi
        sleep "$delay"

        if check_uptimekuma_status; then
            if [[ "$verbose" == "true" ]]; then
                log "✅ UptimeKuma: UP (recovered on retry $retry_attempt)"
            fi
            return 0
        fi
        ((retry_attempt++))
    done

    # All retries failed
    if [[ "$verbose" == "true" ]]; then
        log "⚠️ UptimeKuma still down after ${#retry_delays[@]} retries"
    fi
    return 1
}

check_docker_health() {
    local verbose="${1:-true}"  # Add verbose parameter

    if [[ "$verbose" == "true" ]]; then
        log_quiet "Checking Docker service health..."
    fi

    if ! systemctl is-active --quiet docker; then
        log "Docker service is not running"
        return 1
    fi

    # Check if key containers are running
    local key_containers=("caddy" "cloudflared" "[redacted]" "uptime-kuma" "cloudflare-ddns")
    local failed_containers=()

    for container in "${key_containers[@]}"; do
        if ! docker ps --filter "name=$container" --filter "status=running" \
             --format "{{.Names}}" | grep -q "^$container$"; then
            failed_containers+=("$container")
        fi
    done

    if [[ ${#failed_containers[@]} -gt 0 ]]; then
        log "Failed containers: ${failed_containers[*]}"
        return 1
    fi

    return 0
}

check_tailscale_health() {
    local verbose="${1:-true}"

    if [[ "$verbose" == "true" ]]; then
        log_quiet "Checking Tailscale health..."
    fi

    # Quick pre-check: is the daemon running?
    if ! systemctl is-active --quiet tailscaled; then
        log "❌ tailscaled daemon is not running"
        return 1
    fi

    # Functional check: can tailscale status succeed?
    # This verifies: daemon responding, node authenticated, connected to control plane
    if tailscale status >/dev/null 2>&1; then
        return 0
    fi

    # Retry once after brief pause (transient during DERP switches or key rotation)
    sleep 5
    if tailscale status >/dev/null 2>&1; then
        if [[ "$verbose" == "true" ]]; then
            log "✅ Tailscale: UP (recovered on retry)"
        fi
        return 0
    fi

    log "❌ Tailscale not connected (tailscale status failed after retry)"
    return 1
}

check_mount_integrity() {
    local verbose="${1:-true}"

    if [[ "$verbose" == "true" ]]; then
        log_quiet "Checking critical mount points..."
    fi

    # Check if HDD is mounted
    if ! mountpoint -q "$HDD_MOUNT_POINT"; then
        log "❌ Critical: $HDD_MOUNT_POINT is not mounted"
        return 1
    fi

    # Check if mount is accessible and writable
    local test_file="$HDD_MOUNT_POINT/.healthcheck_$(date +%s)"
    if ! touch "$test_file" 2>/dev/null; then
        log "❌ Critical: $HDD_MOUNT_POINT is mounted but not writable (possible I/O error)"
        return 1
    fi
    rm -f "$test_file" 2>/dev/null

    # Check critical directories exist
    local critical_dirs=(
        "$HDD_MOUNT_POINT/[redacted]/config"
        "$HDD_MOUNT_POINT/beszel"
    )

    for dir in "${critical_dirs[@]}"; do
        if [[ ! -d "$dir" ]]; then
            log "❌ Critical directory missing: $dir"
            return 1
        fi
    done

    # Only log success when verbose logging is requested
    if [[ "$verbose" == "true" ]]; then
        log_quiet "✅ All mount points healthy"
    fi
    return 0
}

# --------------------------------------------------
# Mount recovery function
# --------------------------------------------------
attempt_mount_recovery() {
    log "🔧 Attempting to recover mount: $HDD_MOUNT_POINT"

    # Get device info from /etc/fstab
    local mount_device
    mount_device=$(grep -E "\\s${HDD_MOUNT_POINT}\\s" /etc/fstab | awk '{print $1}')

    if [[ -z "$mount_device" ]]; then
        log "⚠️ Could not find mount device in /etc/fstab for $HDD_MOUNT_POINT"
        return 1
    fi

    log "Found mount device: $mount_device"

    # Detailed HDD status check
    local hdd_status="unknown"

    # Check if USB device is connected (VIA Labs SATA adapter)
    if lsusb | grep -E -q "VLI|VIA Labs.*SATA|2109:0715"; then
        log "✓ USB-SATA adapter detected"

        # Check if encrypted partition exists and is unlocked
        if [[ -e "$mount_device" ]]; then
            log "✓ Encrypted partition is unlocked"
            hdd_status="unlocked"
        else
            log "⚠️ USB device present but encrypted partition NOT unlocked"
            log "This may indicate the LUKS decryption failed at boot"
            notify "🔐 HDD Encryption Issue" "USB drive connected but encrypted partition not unlocked. May need manual cryptsetup."
            hdd_status="not_unlocked"
            return 1
        fi
    else
        log "❌ USB-SATA adapter NOT detected"
        log "The ORICO HDD enclosure is not visible to the system"
        notify "💿 HDD Physically Disconnected" "USB drive not detected. Check: 1) USB cable connected, 2) ORICO power supply connected, 3) LED on enclosure."
        hdd_status="not_connected"
        return 1
    fi

    # If we get here, device exists but is not mounted
    log "HDD Status: $hdd_status - attempting mount recovery"

    local attempt=1
    while [[ $attempt -le $MOUNT_RETRY_ATTEMPTS ]]; do
        log "Mount recovery attempt $attempt/$MOUNT_RETRY_ATTEMPTS"

        # Try to unmount if somehow partially mounted
        if mountpoint -q "$HDD_MOUNT_POINT"; then
            log "Unmounting $HDD_MOUNT_POINT..."
            umount "$HDD_MOUNT_POINT" 2>/dev/null || true
            sleep 2
        fi

        # Try to mount
        log "Attempting to mount $mount_device to $HDD_MOUNT_POINT..."
        if mount "$HDD_MOUNT_POINT"; then
            log "Mount command succeeded, verifying..."
            sleep 5

            # Verify mount is actually working
            if check_mount_integrity "false"; then
                log "✅ Mount recovery successful!"
                notify "🔧 Mount Recovered" "Successfully remounted $HDD_MOUNT_POINT"
                return 0
            else
                log "Mount appears present but failed integrity check"
            fi
        else
            log "Mount command failed"
        fi

        if [[ $attempt -lt $MOUNT_RETRY_ATTEMPTS ]]; then
            log "Waiting ${MOUNT_RETRY_INTERVAL}s before next attempt..."
            sleep "$MOUNT_RETRY_INTERVAL"
        fi

        ((attempt++))
    done

    log "❌ Mount recovery failed after $MOUNT_RETRY_ATTEMPTS attempts"
    return 1
}

# --------------------------------------------------
# Recovery verification with retries
# --------------------------------------------------
verify_recovery() {
    log "Verifying recovery..."

    local attempt=1
    while [[ $attempt -le $RECOVERY_VERIFICATION_RETRIES ]]; do
        log "Recovery verification attempt $attempt/$RECOVERY_VERIFICATION_RETRIES"

        # Check all systems (Tailscale excluded - handled independently)
        local internet_ok=false
        local external_ok=false
        local internal_ok=false
        local docker_ok=false

        if check_internet_connectivity "false"; then
            internet_ok=true
        fi

        if check_external_monitor "true" "false"; then  # wait_for_recovery=true, verbose=false
            external_ok=true
        fi

        if check_internal_monitor "false"; then  # verbose=false
            internal_ok=true
        fi

        if check_docker_health "false"; then  # verbose=false
            docker_ok=true
        fi

        if $internet_ok && $external_ok && $internal_ok && $docker_ok; then
            log "✅ Recovery verification successful"
            return 0
        fi

        log "Recovery verification failed: Internet=$internet_ok, External=$external_ok, Internal=$internal_ok, Docker=$docker_ok"

        if [[ $attempt -lt $RECOVERY_VERIFICATION_RETRIES ]]; then
            log "Waiting ${RECOVERY_VERIFICATION_INTERVAL} seconds before next verification attempt..."
            sleep "$RECOVERY_VERIFICATION_INTERVAL"
        fi

        ((attempt++))
    done

    log "❌ Recovery verification failed after $RECOVERY_VERIFICATION_RETRIES attempts"
    return 1
}

# --------------------------------------------------
# Recovery actions with proper timing and verification
# --------------------------------------------------
wait_for_internet_recovery() {
    log "⏳ Internet connectivity lost - waiting for natural recovery..."
    log "Note: Cannot restart router (HomeLab is at remote location)"
    notify "🌐 Internet Down" "Waiting ${INTERNET_RECOVERY_WAIT}s for internet to recover naturally"

    local elapsed=0
    local check_interval=60  # Check every minute

    while [[ $elapsed -lt $INTERNET_RECOVERY_WAIT ]]; do
        sleep "$check_interval"
        ((elapsed += check_interval))

        log "Checking internet connectivity (${elapsed}s / ${INTERNET_RECOVERY_WAIT}s)..."

        if check_internet_connectivity "false"; then
            log "✅ Internet connectivity restored after ${elapsed}s"
            notify "✅ Internet Restored" "Connection recovered after ${elapsed}s"
            return verify_recovery
        fi
    done

    log "⚠️ Internet still not available after ${INTERNET_RECOVERY_WAIT}s"
    return 1
}

restart_docker_services() {
    log "Restarting Docker services..."

    if systemctl restart docker; then
        log "Docker service restarted successfully"
        sleep "$DOCKER_RESTART_WAIT"

        # Start docker-compose services
        if cd "$HOMELAB_DIR" && doppler run -- docker compose up -d; then
            local compose_exit_code=$?

            # Check if docker compose succeeded
            if [[ $compose_exit_code -eq 0 ]]; then
                log "Docker Compose command completed successfully"
            else
                log "Docker Compose exited with code $compose_exit_code"

                # Check if containers are already running (common "failure" case)
                if docker ps --filter "name=[redacted]" --filter "status=running" --format "{{.Names}}" | grep -q "[redacted]"; then
                    log "Note: Key containers already running - this may be why docker compose reported an issue"
                else
                    log "Docker Compose failed and containers are not running"
                    return 1
                fi
            fi

            log "Waiting for containers to stabilize..."
            sleep "$DOCKER_COMPOSE_STABILIZE_WAIT"

            # Verify containers are actually ready (not just started)
            log "Verifying container readiness..."
            local ready_count=0
            while [[ $ready_count -lt 3 ]]; do
                if check_docker_health "false"; then
                    log "All containers are running and healthy"
                    return verify_recovery
                fi
                log "Containers not ready yet, waiting..."
                sleep 20
                ((ready_count++))
            done

            log "Containers failed to become ready"
            return 1
        else
            local compose_exit_code=$?
            log "Failed to start Docker Compose services (exit code: $compose_exit_code)"

            # Even if compose failed, check if services are actually running
            log "Checking if containers are running despite compose failure..."
            if check_docker_health "false"; then
                log "⚠️ Docker Compose reported failure but containers are running - treating as success"
                return verify_recovery
            fi

            return 1
        fi
    else
        log "Failed to restart Docker service"
        return 1
    fi
}

restart_network_interface() {
    log "Restarting network interface..."

    # Get the default network interface
    local interface
    interface=$(ip route show default | awk '/default/ {print $5; exit}')

    if [[ -n "$interface" ]]; then
        if ip link set "$interface" down && sleep 5 && ip link set "$interface" up; then
            log "Network interface $interface restarted"
            log "Waiting ${NETWORK_STABILIZE_WAIT} seconds for network to stabilize..."
            sleep "$NETWORK_STABILIZE_WAIT"

            # Verify network connectivity is restored
            if check_internet_connectivity "false"; then
                log "Network connectivity restored"
                return verify_recovery
            else
                log "Network connectivity not restored after interface restart"
                return 1
            fi
        else
            log "Failed to restart network interface $interface"
            return 1
        fi
    else
        log "Could not determine default network interface"
        return 1
    fi
}

handle_tailscale_failure() {
    log "🔗 Tailscale health check failed - attempting restart"

    if systemctl restart tailscaled; then
        log "tailscaled restarted, waiting ${TAILSCALE_RESTART_WAIT}s for reconnection..."
        sleep "$TAILSCALE_RESTART_WAIT"

        if check_tailscale_health "false"; then
            log "✅ Tailscale recovered after restart"
            if [[ -f "$TAILSCALE_FAILURE_FILE" ]]; then
                rm -f "$TAILSCALE_FAILURE_FILE"
                notify "✅ Tailscale Restored" "tailscaled recovered after restart - private services accessible"
            fi
            return 0
        fi
    fi

    # Restart failed or tailscale still unhealthy
    if [[ ! -f "$TAILSCALE_FAILURE_FILE" ]]; then
        # First failure cycle: notify
        touch "$TAILSCALE_FAILURE_FILE"
        notify "⚠️ Tailscale Down" "7 private services unreachable. tailscaled restart failed."
    else
        # Repeated failure: just log, don't re-notify
        log "⚠️ Tailscale still down (already notified)"
    fi
    return 1
}

handle_tailscale_recovery() {
    if [[ -f "$TAILSCALE_FAILURE_FILE" ]]; then
        rm -f "$TAILSCALE_FAILURE_FILE"
        notify "✅ Tailscale Restored" "Private services accessible again"
        log "✅ Tailscale recovered (was previously failing)"
    fi
}

force_docker_cleanup() {
    log "Performing aggressive Docker cleanup and restart..."

    # Stop all containers gracefully first
    if docker ps -q | grep -q .; then
        log "Stopping all running containers..."
        docker stop $(docker ps -q) || true
    fi

    # System cleanup (safe - preserves volumes and bind mounts)
    log "Cleaning up unused Docker resources..."
    docker system prune -f &>/dev/null || true

    # Stop and restart Docker daemon
    systemctl stop docker
    sleep 10
    systemctl start docker
    sleep "$DOCKER_RESTART_WAIT"

    # Restart services
    if cd "$HOMELAB_DIR" && docker compose down && doppler run -- docker compose up -d; then
        log "Docker services restarted after cleanup, waiting for stabilization..."
        sleep "$DOCKER_COMPOSE_STABILIZE_WAIT"

        return verify_recovery
    else
        log "Failed to restart Docker services after cleanup"
        return 1
    fi
}

check_reboot_limits() {
    local today
    today=$(date +%Y-%m-%d)

    # Create tracking file if it doesn't exist
    if [[ ! -f "$REBOOT_TRACKING_FILE" ]]; then
        echo "$today:0" > "$REBOOT_TRACKING_FILE"
        return 0
    fi

    # Read current tracking data
    local tracked_date tracked_count
    IFS=':' read -r tracked_date tracked_count < "$REBOOT_TRACKING_FILE"

    # Reset counter if it's a new day
    if [[ "$tracked_date" != "$today" ]]; then
        echo "$today:0" > "$REBOOT_TRACKING_FILE"
        return 0
    fi

    # Check if we've exceeded the limit
    if [[ "$tracked_count" -ge "$MAX_REBOOTS_PER_DAY" ]]; then
        log "🚨 CRITICAL: Maximum reboots per day ($MAX_REBOOTS_PER_DAY) exceeded"
        log "Creating manual intervention flag - automatic recovery suspended"
        touch "$MANUAL_INTERVENTION_FLAG"
        notify "🚨 MANUAL INTERVENTION REQUIRED" "Max reboots ($MAX_REBOOTS_PER_DAY) reached today. Automatic recovery suspended. Please investigate manually."
        return 1
    fi

    return 0
}

increment_reboot_counter() {
    local today
    today=$(date +%Y-%m-%d)

    local tracked_date tracked_count
    IFS=':' read -r tracked_date tracked_count < "$REBOOT_TRACKING_FILE"

    # Increment counter
    ((tracked_count++))
    echo "$today:$tracked_count" > "$REBOOT_TRACKING_FILE"

    log "Reboot counter: $tracked_count/$MAX_REBOOTS_PER_DAY for $today"
}

check_manual_intervention_flag() {
    if [[ -f "$MANUAL_INTERVENTION_FLAG" ]]; then
        log "🚨 Manual intervention flag detected - automatic recovery suspended"
        log "Remove $MANUAL_INTERVENTION_FLAG to resume automatic recovery"
        notify "⚠️ Recovery Suspended" "Manual intervention required. Remove flag file to resume: $MANUAL_INTERVENTION_FLAG"
        return 1
    fi
    return 0
}

reboot_system() {
    # Check if manual intervention is required
    if ! check_reboot_limits; then
        log "🛑 Reboot aborted - manual intervention required"
        return 1
    fi

    log "🚨 INITIATING SYSTEM REBOOT (last resort)"

    # Increment reboot counter
    increment_reboot_counter

    # Log the reason for reboot
    local current_state
    current_state=$(get_current_state)
    log "Reboot triggered at escalation level: $current_state"
    log "System will restart and services should auto-recover"
    log "Reboot count today: $(cat "$REBOOT_TRACKING_FILE" | cut -d: -f2)/$MAX_REBOOTS_PER_DAY"

    # Give notification time to send and flush any pending notifications
    flush_notifications
    sleep 5

    # Ensure all data is written to disk
    sync

    log "System reboot initiated - watchdog will resume after restart"

    # Reboot the system
    reboot
}

# --------------------------------------------------
# Intelligent failure analysis and targeted recovery
# --------------------------------------------------
analyze_failure_and_recover() {
    log "=== System failures detected - initiating recovery ==="

    local current_state
    current_state=$(get_current_state)

    # Ensure current_state is valid
    if [[ ! "$current_state" =~ ^[0-4]$ ]]; then
        current_state=0
        set_state 0
    fi

    log "Current escalation state: $current_state"
    log "=== Analyzing failure pattern for targeted recovery ==="

    # Re-verify failures before taking recovery action
    log "Re-checking failed systems to confirm recovery is needed..."
    sleep 2  # Brief pause before re-check

    # Re-run checks to confirm failure (Tailscale excluded - handled independently in perform_health_checks)
    local internet_ok_recheck=false
    local external_ok_recheck=false
    local internal_ok_recheck=false
    local docker_ok_recheck=false

    if check_internet_connectivity "false"; then
        internet_ok_recheck=true
    fi

    if check_external_monitor "false" "false"; then
        external_ok_recheck=true
    fi

    if check_internal_monitor "false"; then
        internal_ok_recheck=true
    fi

    if check_docker_health "false"; then
        docker_ok_recheck=true
    fi

    # If everything is now healthy, the issue resolved itself
    if $internet_ok_recheck && $external_ok_recheck && $internal_ok_recheck && $docker_ok_recheck; then
        log "✅ Re-check shows all systems healthy - issue resolved itself"
        log "No recovery action needed"
        set_state 0
        return 0
    fi

    log "Re-check confirmed failures: Internet=$internet_ok_recheck, External=$external_ok_recheck, Internal=$internal_ok_recheck, Docker=$docker_ok_recheck"
    log "Proceeding with recovery actions..."

    # Check mount integrity first - if this fails, try to recover it
    if ! check_mount_integrity "false"; then
        log "🔍 DIAGNOSIS: Critical mount failure detected"

        # Try to recover the mount first
        if attempt_mount_recovery; then
            log "✅ Mount recovered successfully - resetting state"
            set_state 0
            return 0
        fi

        # Mount recovery failed - check why it failed
        # If HDD is physically disconnected or not unlocked, don't escalate aggressively
        local mount_device
        mount_device=$(grep -E "\\s${HDD_MOUNT_POINT}\\s" /etc/fstab | awk '{print $1}')

        if ! lsusb | grep -E -q "VLI|VIA Labs.*SATA|2109:0715"; then
            # USB device not connected - this is a hardware issue, not software
            log "🔍 DIAGNOSIS: HDD physically disconnected - requires manual intervention"
            notify "💿 Manual Intervention" "External HDD is not connected. This requires physical access to reconnect the drive."
            # Don't escalate - just wait for manual fix
            touch "$MANUAL_INTERVENTION_FLAG"
            return 1
        elif [[ ! -e "$mount_device" ]]; then
            # USB connected but partition not unlocked - encryption issue
            log "🔍 DIAGNOSIS: Encryption issue - partition not unlocked"
            notify "🔐 Manual Intervention" "HDD encryption issue - partition not unlocked. May need manual cryptsetup."
            # Don't escalate - encryption issues need manual intervention
            touch "$MANUAL_INTERVENTION_FLAG"
            return 1
        else
            # Device exists but mount fails - this could be I/O error or filesystem corruption
            log "🔍 DIAGNOSIS: Mount failure despite device being present"

            # Check for I/O errors in dmesg (indicates unstable USB or failing drive)
            if dmesg | tail -50 | grep -q -i "I/O error\|usb.*disconnect"; then
                log "⚠️ Detected I/O errors or USB instability in kernel log"
                log "This suggests hardware issues (bad USB cable, failing drive, or power issues)"

                case "$current_state" in
                    0|1)
                        log "Escalating cautiously - waiting for USB to stabilize"
                        notify "⚠️ HDD Hardware Issue" "Detected I/O errors or USB instability. Monitoring. (Attempt $((current_state + 1))/3)"
                        set_state $((current_state + 1))
                        return 1
                        ;;
                    2)
                        log "Persistent hardware issues - requiring manual intervention"
                        notify "🚨 Manual Intervention Required" "Persistent HDD hardware issues detected. Check USB cable, power supply, and drive health."
                        touch "$MANUAL_INTERVENTION_FLAG"
                        return 1
                        ;;
                esac
            else
                # No obvious hardware issue - try normal escalation
                case "$current_state" in
                    0|1|2)
                        log "Mount recovery failed - escalating (state: $current_state → $((current_state + 1)))"
                        notify "⚠️ Mount Recovery Failed" "Cannot remount storage - escalating recovery (attempt $((current_state + 1)))"
                        set_state $((current_state + 1))
                        return 1
                        ;;
                    *)
                        log "🔍 DIAGNOSIS: Persistent mount failure - system reboot required"
                        notify "🚨 CRITICAL MOUNT FAILURE" "Storage persistently inaccessible - system reboot initiated"
                        reboot_system
                        return 1
                        ;;
                esac
            fi
        fi
    fi

    # Re-check specific failed components only
    local internet_ok=false
    local external_ok=false
    local internal_ok=false
    local docker_ok=false

    if check_internet_connectivity "false"; then
        internet_ok=true
    fi

    if check_external_monitor "false" "false"; then  # wait_for_recovery=false, verbose=false
        external_ok=true
    fi

    if check_internal_monitor "false"; then  # verbose=false
        internal_ok=true
    fi

    if check_docker_health "false"; then  # verbose=false
        docker_ok=true
    fi

    log "Failure analysis: Internet=$internet_ok, External=$external_ok, Internal=$internal_ok, Docker=$docker_ok"

    # If we've been in escalation state 3+ for multiple cycles and still failing, consider reboot
    if [[ "$current_state" -ge 3 ]]; then
        # Check if this is a persistent complex failure pattern
        if ! $external_ok && ! $internal_ok && ! $docker_ok; then
            log "🔍 DIAGNOSIS: Persistent multi-system failure after escalation - system reboot recommended"
            log "RECOVERY ACTION: System reboot (multiple recovery attempts failed)"
            notify "🚨 PERSISTENT FAILURE" "Multiple systems failing after recovery attempts - system reboot"
            reboot_system
            return 1
        fi
    fi

    # Smart recovery logic based on failure pattern
    if ! $internet_ok; then
        # No internet = network issue, wait for recovery (cannot restart router remotely)
        log "🔍 DIAGNOSIS: Internet connectivity failure - network issue likely"

        case "$current_state" in
            0|1)
                log "RECOVERY ACTION: Waiting for internet to recover naturally"
                notify "🌐 Network Issue" "Internet down - monitoring for recovery"

                if wait_for_internet_recovery; then
                    notify "✅ Network Restored" "Internet connection recovered"
                    set_state 0
                    return 0
                else
                    set_state 2
                    return 1
                fi
                ;;
            2)
                log "RECOVERY ACTION: Restarting network interface"
                notify "🔄 Network Interface" "Internet recovery wait exhausted - restarting network interface"

                if restart_network_interface; then
                    notify "✅ Network Restored" "Network interface restart resolved the issue"
                    set_state 0
                    return 0
                else
                    set_state 3
                    return 1
                fi
                ;;
            *)
                log "RECOVERY ACTION: System reboot (network recovery exhausted)"
                notify "🚨 Network Critical" "Persistent internet failure - system reboot"
                reboot_system
                ;;
        esac

    elif $internet_ok && ! $docker_ok; then
        # Internet OK but Docker problems = service issue
        log "🔍 DIAGNOSIS: Docker service failure - containers down"

        case "$current_state" in
            0|1)
                log "RECOVERY ACTION: Restarting Docker services"
                notify "🐳 Docker Issue" "Containers down - restarting Docker services"

                if restart_docker_services; then
                    notify "✅ Services Restored" "Docker restart resolved container issues"
                    set_state 0
                    return 0
                else
                    set_state 3
                    return 1
                fi
                ;;
            3)
                log "RECOVERY ACTION: Aggressive Docker cleanup"
                notify "🔄 Deep Docker Cleanup" "Standard restart failed - performing deep cleanup"

                if force_docker_cleanup; then
                    notify "✅ Services Restored" "Docker cleanup resolved the issue"
                    set_state 0
                    return 0
                else
                    set_state 4
                    return 1
                fi
                ;;
            *)
                log "RECOVERY ACTION: System reboot (Docker recovery exhausted)"
                notify "🚨 Docker Critical" "All Docker recovery methods failed - system reboot"
                reboot_system
                ;;
        esac

    elif $internet_ok && $docker_ok && (! $external_ok || ! $internal_ok); then
        # Local services OK but monitoring reports issues = possible network routing or service accessibility
        log "🔍 DIAGNOSIS: Monitoring discrepancy - services running but not accessible"

        case "$current_state" in
            0|1)
                log "RECOVERY ACTION: Light Docker restart (fix service accessibility)"
                notify "🔄 Service Access" "Services running but not accessible - restarting containers"

                if restart_docker_services; then
                    notify "✅ Access Restored" "Service accessibility restored"
                    set_state 0
                    return 0
                else
                    set_state 2
                    return 1
                fi
                ;;
            2)
                log "RECOVERY ACTION: Network interface restart (fix routing)"
                notify "🔄 Network Routing" "Restarting network interface to fix routing"

                if restart_network_interface; then
                    notify "✅ Routing Fixed" "Network routing restored"
                    set_state 0
                    return 0
                else
                    set_state 3
                    return 1
                fi
                ;;
            *)
                log "RECOVERY ACTION: Escalated recovery"
                return escalated_recovery
                ;;
        esac

    else
        # Multiple or complex failure = escalated response
        log "🔍 DIAGNOSIS: Complex failure pattern - using escalated recovery"
        return escalated_recovery
    fi
}

escalated_recovery() {
    local current_state
    current_state=$(get_current_state)

    case "$current_state" in
        3)
            log "ESCALATION: Force Docker cleanup and restart"
            notify "🔄 Deep Cleanup" "Complex failure - performing deep Docker cleanup"

            if force_docker_cleanup; then
                notify "✅ System Recovered" "Deep cleanup resolved complex issues"
                set_state 0
                return 0
            else
                set_state 4
                return 1
            fi
            ;;
        4)
            log "ESCALATION: System reboot (last resort)"
            notify "🚨 CRITICAL" "System reboot - all recovery methods exhausted"
            reboot_system
            ;;
        *)
            # Start escalated recovery - try network interface restart
            log "ESCALATION: Starting with network interface restart"
            notify "🔄 Complex Recovery" "Complex failure detected - restarting network interface"

            if restart_network_interface; then
                notify "✅ Network Reset" "Network interface restart helped with complex issue"
                set_state 0
                return 0
            else
                set_state 3
                return 1
            fi
            ;;
    esac
}

reset_state_on_success() {
    local current_state
    current_state=$(get_current_state)

    if [[ "$current_state" != "0" ]]; then
        log "Services recovered, resetting escalation state from level $current_state to 0"
        notify "🟢 System Restored" "All services healthy - escalation reset"
        set_state 0
    fi
}

# --------------------------------------------------
# Comprehensive health assessment
# --------------------------------------------------
perform_health_checks() {
    # Store results to avoid double-checking
    local internet_ok=false
    local external_ok=false
    local internal_ok=false
    local docker_ok=false
    local mounts_ok=false

    # Check mount integrity FIRST - if this fails, nothing else will work
    if check_mount_integrity; then  # Default verbose=true for main health checks
        mounts_ok=true
    else
        # If mounts are broken, skip other checks and escalate immediately
        log "🔴 Mount failure detected - skipping other health checks"
        return 1
    fi

    # Check internet connectivity
    if check_internet_connectivity; then
        internet_ok=true
    fi

    # External monitoring (primary)
    if check_external_monitor "false" "true"; then  # wait_for_recovery=false, verbose=true
        external_ok=true
    fi

    # Internal monitoring (secondary/validation)
    if check_internal_monitor "true"; then  # verbose=true
        internal_ok=true
    fi

    # Docker health (infrastructure)
    if check_docker_health "true"; then  # verbose=true
        docker_ok=true
    fi

    # Tailscale: handled independently, doesn't affect overall result.
    # Has its own recovery (restart tailscaled) and notification state
    # to avoid spamming. Doesn't trigger Docker/network escalation.
    if check_tailscale_health "true"; then
        handle_tailscale_recovery  # clear failure flag if was previously failing
    else
        handle_tailscale_failure   # restart tailscaled, notify once on failure
    fi

    # Only log failures and summary
    local failed_checks=()
    if ! $mounts_ok; then
        failed_checks+=("Mount Points")
    fi
    if ! $internet_ok; then
        failed_checks+=("Internet")
    fi
    if ! $external_ok; then
        failed_checks+=("External Monitor")
    fi
    if ! $internal_ok; then
        failed_checks+=("Internal Monitor")
    fi
    if ! $docker_ok; then
        failed_checks+=("Docker")
    fi

    # Evaluate results (Tailscale excluded - handled independently above)
    if $external_ok && $internal_ok && $docker_ok && $internet_ok && $mounts_ok; then
        log_quiet "🟢 All systems healthy"
        return 0
    else
        log "❌ Failed checks: ${failed_checks[*]}"
        if ! $mounts_ok; then
            log "🔴 CRITICAL: Storage mount failure - system reboot required"
        elif $external_ok && $internal_ok; then
            log "🟡 Monitors healthy but Docker issues detected"
        elif $internal_ok && $docker_ok; then
            log "🟡 Internal systems healthy but external connectivity issues"
        else
            log "🔴 Multiple system failures detected"
        fi
        return 1
    fi
}

# --------------------------------------------------
# Main execution function
# --------------------------------------------------
main() {
    log_quiet "=== HomeLab WatchDog Started (PID: $$) ==="

    # Load configuration (needed for health checks)
    load_credentials

    # Install jq if not available (for JSON parsing)
    if ! command -v jq &>/dev/null; then
        log "Installing jq for JSON parsing..."
        apt-get update &>/dev/null && apt-get install -y jq &>/dev/null || log "Warning: Could not install jq, using fallback parsing"
    fi

    # Check if manual intervention flag is set
    # Even if set, we still run health checks - if system is healthy, auto-clear the flag
    # This allows self-healing after long outages (e.g., ISP down for hours)
    if [[ -f "$MANUAL_INTERVENTION_FLAG" ]]; then
        log "⚠️ Manual intervention flag detected - checking if system has recovered..."

        if perform_health_checks; then
            log "✅ System healthy - auto-clearing manual intervention flag"
            rm -f "$MANUAL_INTERVENTION_FLAG"
            set_state 0
            notify "🟢 Auto-Recovery" "System healthy after manual intervention period - resuming normal operation"
            flush_notifications
            send_uptime_kuma_heartbeat
            log_quiet "=== HomeLab WatchDog completed successfully (auto-recovered) ==="
            return 0
        else
            log "❌ System still unhealthy - manual intervention still required"
            log "Remove $MANUAL_INTERVENTION_FLAG manually once issue is resolved"
            notify "⚠️ Still Unhealthy" "System checked but still failing - manual intervention required"
            flush_notifications
            send_uptime_kuma_heartbeat
            return 1
        fi
    fi

    # Normal operation - perform health checks
    if perform_health_checks; then
        reset_state_on_success
    else
        if analyze_failure_and_recover; then
            log "=== Recovery successful ==="
        else
            log "=== Recovery failed - escalation continues ==="
        fi
    fi

    # Send any queued notifications (grouped together)
    flush_notifications

    # Send heartbeat to Uptime Kuma (if configured)
    send_uptime_kuma_heartbeat

    log_quiet "=== HomeLab WatchDog completed successfully ==="
    log_quiet "=== HomeLab WatchDog session ended ==="
}

# --------------------------------------------------
# Script execution
# --------------------------------------------------
main "$@"