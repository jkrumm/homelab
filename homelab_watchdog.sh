#!/bin/bash
set -euo pipefail

# --------------------------------------------------
# HomeLab WatchDog Script - Complete Self-Healing Solution
# --------------------------------------------------
# Multi-level health monitoring with graduated response
# Prevents simultaneous execution with proper locking
# Integrates Fritz!Box restart via TR-064 protocol
# --------------------------------------------------

# Configuration
readonly SCRIPT_NAME="homelab_watchdog"
readonly LOCK_FILE="/var/run/${SCRIPT_NAME}.lock"
readonly STATE_DIR="/var/lib/${SCRIPT_NAME}"
readonly STATE_FILE="${STATE_DIR}/state"
readonly LOG_FILE="/var/log/${SCRIPT_NAME}.log"
readonly QUEUE_FILE="${STATE_DIR}/pushover_queue"
readonly CREDS_FILE="/root/.homelab-watchdog-credentials"

# Network and service configuration
readonly FRITZ_IP="192.168.178.1"
readonly HOMELAB_DIR="/home/jkrumm/homelab"

# Timeouts and intervals (in seconds)
readonly HEALTH_CHECK_TIMEOUT=30
readonly DOCKER_RESTART_WAIT=120
readonly DOCKER_COMPOSE_STABILIZE_WAIT=60  # Time for containers to fully start
readonly INTERNET_CHECK_TIMEOUT=20
readonly FRITZBOX_REBOOT_WAIT=300
readonly FRITZBOX_VERIFY_WAIT=60  # Time to wait before verifying router is back
readonly NETWORK_STABILIZE_WAIT=60  # Extended time for network to stabilize
readonly EXTERNAL_MONITOR_PATIENCE_WAIT=260  # Only used after recovery actions
readonly RECOVERY_VERIFICATION_RETRIES=3
readonly RECOVERY_VERIFICATION_INTERVAL=30
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

    # Validate required variables
    local required_vars=("BETTERSTACK_TOKEN" "PUSHOVER_USER_KEY" "PUSHOVER_API_TOKEN" "FRITZ_USER" "FRITZ_PASSWORD")
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            log "ERROR: Missing required variable: $var"
            exit 1
        fi
    done
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

    if curl -s --max-time 10 https://api.pushover.net/1/messages.json \
           -F "token=$PUSHOVER_API_TOKEN" \
           -F "user=$PUSHOVER_USER_KEY" \
           -F "title=HomeLab WatchDog" \
           -F "message=• $msgs" > /dev/null 2>&1; then
        > "$QUEUE_FILE"  # Clear queue on success
        log_quiet "Notifications sent successfully"
    else
        log "Failed to send notifications, keeping in queue"
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

    # First attempt
    local resp
    if ! resp=$(timeout "$HEALTH_CHECK_TIMEOUT" curl -s \
                -H "Authorization: Bearer $BETTERSTACK_TOKEN" \
                https://uptime.betterstack.com/api/v2/monitors/3000673 2>/dev/null); then
        log "Failed to reach BetterStack API"
        return 1
    fi


    # Parse JSON response for first attempt
    local first_result=false
    if command -v jq &>/dev/null; then
        if echo "$resp" | jq -e '.data.attributes.status == "up"' &>/dev/null; then
            first_result=true
        fi
    else
        # Fallback to grep if jq not available
        if echo "$resp" | grep -q '"status":"up"'; then
            first_result=true
        fi
    fi

    # If first attempt succeeded
    if [[ "$first_result" == "true" ]]; then
        return 0
    fi

    # First attempt failed - only wait if we're checking after recovery
    if [[ "$wait_for_recovery" == "true" ]]; then
        log "BetterStack reports down after recovery - waiting for monitor cycle to detect changes..."
        sleep "$EXTERNAL_MONITOR_PATIENCE_WAIT"

        log "Re-checking external monitor after patience period..."
        if ! resp=$(timeout "$HEALTH_CHECK_TIMEOUT" curl -s \
                    -H "Authorization: Bearer $BETTERSTACK_TOKEN" \
                    https://uptime.betterstack.com/api/v2/monitors/3000673 2>/dev/null); then
            log "Failed to reach BetterStack API on second attempt"
            return 1
        fi

        # Parse JSON response for second attempt
        if command -v jq &>/dev/null; then
            if echo "$resp" | jq -e '.data.attributes.status == "up"' &>/dev/null; then
                log "BetterStack reports: UP (recovered during patience period)"
                return 0
            fi
        else
            if echo "$resp" | grep -q '"status":"up"'; then
                log "BetterStack reports: UP (recovered during patience period)"
                return 0
            fi
        fi

        log "BetterStack still reports down after patience period"
    fi

    return 1
}

check_internal_monitor() {
    local verbose="${1:-true}"  # Add verbose parameter

    if [[ "$verbose" == "true" ]]; then
        log_quiet "Checking internal monitor (UptimeKuma)..."
    fi

    local resp
    if ! resp=$(timeout "$HEALTH_CHECK_TIMEOUT" curl -s \
                http://localhost:3010/api/status-page/homelab-watchdog 2>/dev/null); then
        log "Failed to reach internal UptimeKuma API"
        return 1
    fi


    # Check if we got a valid JSON response
    if ! echo "$resp" | grep -q '"config".*"incident"'; then
        log "Invalid response format from UptimeKuma API"
        return 1
    fi

    # Parse JSON response - check for incidents and maintenance
    if command -v jq &>/dev/null; then
        # Use jq for proper JSON parsing
        local incident_status maintenance_count
        incident_status=$(echo "$resp" | jq -r '.incident // "null"')
        maintenance_count=$(echo "$resp" | jq -r '.maintenanceList | length')

        if [[ "$incident_status" == "null" && "$maintenance_count" == "0" ]]; then
            return 0
        else
            if [[ "$incident_status" != "null" ]]; then
                log "UptimeKuma reports: INCIDENT DETECTED"
            fi
            if [[ "$maintenance_count" != "0" ]]; then
                log "UptimeKuma reports: MAINTENANCE ACTIVE ($maintenance_count items)"
            fi
            return 1
        fi
    else
        # Fallback to grep if jq not available
        if echo "$resp" | grep -q '"incident":null' && echo "$resp" | grep -q '"maintenanceList":\[\]'; then
            return 0
        else
            # Check what's wrong
            if echo "$resp" | grep -vq '"incident":null'; then
                log "UptimeKuma reports: INCIDENT DETECTED"
            fi
            if echo "$resp" | grep -vq '"maintenanceList":\[\]'; then
                log "UptimeKuma reports: MAINTENANCE ACTIVE"
            fi
            return 1
        fi
    fi
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
    local key_containers=("jellyfin" "uptime-kuma" "porkbun-ddns")
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

check_mount_integrity() {
    local verbose="${1:-true}"

    if [[ "$verbose" == "true" ]]; then
        log_quiet "Checking critical mount points..."
    fi

    # Check if HDD is mounted
    if ! mountpoint -q /mnt/hdd; then
        log "❌ Critical: /mnt/hdd is not mounted"
        return 1
    fi

    # Check if mount is accessible and writable
    local test_file="/mnt/hdd/.healthcheck_$(date +%s)"
    if ! touch "$test_file" 2>/dev/null; then
        log "❌ Critical: /mnt/hdd is mounted but not writable"
        return 1
    fi
    rm -f "$test_file" 2>/dev/null

    # Check critical directories exist
    local critical_dirs=(
        "/mnt/hdd/jellyfin/config"
        "/mnt/hdd/uptimekuma"
        "/mnt/hdd/beszel"
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
# Recovery verification with retries
# --------------------------------------------------
verify_recovery() {
    log "Verifying recovery..."

    local attempt=1
    while [[ $attempt -le $RECOVERY_VERIFICATION_RETRIES ]]; do
        log "Recovery verification attempt $attempt/$RECOVERY_VERIFICATION_RETRIES"

        # Check all systems
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
restart_fritzbox() {
    log "Attempting Fritz!Box reboot via TR-064 protocol..."

    # TR-064 SOAP request parameters
    local location="/upnp/control/deviceconfig"
    local uri="urn:dslforum-org:service:DeviceConfig:1"
    local action="Reboot"
    local soap_request="<?xml version='1.0' encoding='utf-8'?><s:Envelope s:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/' xmlns:s='http://schemas.xmlsoap.org/soap/envelope/'><s:Body><u:$action xmlns:u='$uri'></u:$action></s:Body></s:Envelope>"

    # Execute TR-064 reboot command
    if curl -k -m 10 --anyauth -u "$FRITZ_USER:$FRITZ_PASSWORD" \
       "http://$FRITZ_IP:49000$location" \
       -H 'Content-Type: text/xml; charset="utf-8"' \
       -H "SoapAction:$uri#$action" \
       -d "$soap_request" \
       -s > /dev/null 2>&1; then
        log "Fritz!Box reboot command sent successfully"
        log "Waiting ${FRITZBOX_REBOOT_WAIT} seconds for Fritz!Box to restart..."
        sleep "$FRITZBOX_REBOOT_WAIT"

        # Verify Fritz!Box is back online
        log "Verifying Fritz!Box connectivity..."
        local retry_count=0
        while [[ $retry_count -lt 5 ]]; do
            if ping -c 1 "$FRITZ_IP" &>/dev/null; then
                log "Fritz!Box is responding to ping"
                sleep "$FRITZBOX_VERIFY_WAIT"  # Additional stabilization time
                return verify_recovery
            fi
            log "Fritz!Box not responding yet, retrying in 30 seconds..."
            sleep 30
            ((retry_count++))
        done

        log "Fritz!Box not responding after reboot"
        return 1
    else
        log "Fritz!Box reboot command failed"
        return 1
    fi
}

restart_docker_services() {
    log "Restarting Docker services..."

    if systemctl restart docker; then
        log "Docker service restarted successfully"
        sleep "$DOCKER_RESTART_WAIT"

        # Start docker-compose services
        if cd "$HOMELAB_DIR" && doppler run -- docker compose up -d; then
            log "Docker Compose services started, waiting for containers to stabilize..."
            sleep "$DOCKER_COMPOSE_STABILIZE_WAIT"

            # Verify containers are actually ready (not just started)
            log "Verifying container readiness..."
            local ready_count=0
            while [[ $ready_count -lt 3 ]]; do
                if check_docker_health; then
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
            log "Failed to start Docker Compose services"
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

    # Check mount integrity first - if this fails, reboot immediately
    if ! check_mount_integrity "false"; then
        log "🔍 DIAGNOSIS: Critical mount failure - immediate system reboot required"
        notify "🚨 CRITICAL MOUNT FAILURE" "Storage not accessible - system reboot initiated"
        reboot_system
        return 1
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
        # No internet = network issue, try Fritz!Box restart first
        log "🔍 DIAGNOSIS: Internet connectivity failure - network issue likely"

        case "$current_state" in
            0|1)
                log "RECOVERY ACTION: Restarting Fritz!Box (network-focused)"
                notify "🌐 Network Issue" "Internet down - restarting Fritz!Box"

                if restart_fritzbox; then
                    notify "✅ Network Restored" "Fritz!Box restart resolved internet issue"
                    set_state 0
                    return 0
                else
                    set_state 2
                    return 1
                fi
                ;;
            2)
                log "RECOVERY ACTION: Restarting network interface"
                notify "🔄 Network Interface" "Fritz!Box restart failed - trying network interface"

                if restart_network_interface; then
                    notify "✅ Network Restored" "Network interface restart resolved the issue"
                    set_state 0
                    return 0
                else
                    set_state 4
                    return 1
                fi
                ;;
            *)
                log "RECOVERY ACTION: System reboot (network recovery exhausted)"
                notify "🚨 Network Critical" "All network recovery methods failed - system reboot"
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
            # Start escalated recovery
            log "ESCALATION: Starting with Fritz!Box restart"
            notify "🔄 Complex Recovery" "Complex failure detected - starting systematic recovery"

            if restart_fritzbox; then
                notify "✅ Network Reset" "Fritz!Box restart helped with complex issue"
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

    # Evaluate results
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

    # Check if manual intervention is required
    if ! check_manual_intervention_flag; then
        log "=== HomeLab WatchDog suspended - manual intervention required ==="
        return 1
    fi

    # Load configuration
    load_credentials

    # Install jq if not available (for JSON parsing)
    if ! command -v jq &>/dev/null; then
        log "Installing jq for JSON parsing..."
        apt-get update &>/dev/null && apt-get install -y jq &>/dev/null || log "Warning: Could not install jq, using fallback parsing"
    fi

    # Perform health checks
    if perform_health_checks; then
        reset_state_on_success
        log_quiet "=== HomeLab WatchDog completed successfully ==="
    else
        if analyze_failure_and_recover; then
            log "=== Recovery successful ==="
        else
            log "=== Recovery failed - escalation continues ==="
        fi
    fi

    # Send any queued notifications (grouped together)
    flush_notifications

    log_quiet "=== HomeLab WatchDog session ended ==="
}

# --------------------------------------------------
# Script execution
# --------------------------------------------------
main "$@"