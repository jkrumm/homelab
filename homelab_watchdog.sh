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
readonly INTERNET_CHECK_TIMEOUT=20
readonly FRITZBOX_REBOOT_WAIT=180

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
        log "Notifications sent successfully"
    else
        log "Failed to send notifications, keeping in queue"
    fi
}

get_current_state() {
    if [[ -f "$STATE_FILE" ]]; then
        cat "$STATE_FILE"
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
    log "Checking internet connectivity..."
    
    # Try multiple DNS servers
    local dns_servers=("8.8.8.8" "1.1.1.1" "9.9.9.9")
    
    for dns in "${dns_servers[@]}"; do
        if timeout "$INTERNET_CHECK_TIMEOUT" ping -c 1 "$dns" &>/dev/null; then
            log "Internet connectivity confirmed via $dns"
            return 0
        fi
    done
    
    # Try DNS resolution as fallback
    if timeout "$INTERNET_CHECK_TIMEOUT" nslookup google.com &>/dev/null; then
        log "Internet connectivity confirmed via DNS resolution"
        return 0
    fi
    
    log "No internet connectivity detected"
    return 1
}

check_external_monitor() {
    log "Checking external monitor (BetterStack)..."
    
    local resp
    if ! resp=$(timeout "$HEALTH_CHECK_TIMEOUT" curl -s \
                -H "Authorization: Bearer $BETTERSTACK_TOKEN" \
                https://uptime.betterstack.com/api/v2/monitors/3000673 2>/dev/null); then
        log "Failed to reach BetterStack API"
        return 1
    fi

    # Parse JSON response
    if command -v jq &>/dev/null; then
        if echo "$resp" | jq -e '.data.attributes.status == "up"' &>/dev/null; then
            log "BetterStack reports: UP"
            return 0
        else
            log "BetterStack reports: DOWN or unknown status"
            return 1
        fi
    else
        # Fallback to grep if jq not available
        if echo "$resp" | grep -q '"status":"up"'; then
            log "BetterStack reports: UP"
            return 0
        else
            log "BetterStack reports: DOWN or unknown status"
            return 1
        fi
    fi
}

check_internal_monitor() {
    log "Checking internal monitor (UptimeKuma)..."
    
    local resp
    if ! resp=$(timeout "$HEALTH_CHECK_TIMEOUT" curl -s \
                http://localhost:3010/api/status-page/homelab 2>/dev/null); then
        log "Failed to reach internal UptimeKuma API"
        return 1
    fi
    
    # Basic check for internal status - adjust based on your UptimeKuma setup
    if echo "$resp" | grep -q '"status".*[12]' || echo "$resp" | grep -qi "up\|online\|ok"; then
        log "UptimeKuma reports: HEALTHY"
        return 0
    else
        log "UptimeKuma reports: UNHEALTHY"
        return 1
    fi
}

check_docker_health() {
    log "Checking Docker service health..."
    
    if ! systemctl is-active --quiet docker; then
        log "Docker service is not running"
        return 1
    fi
    
    # Check if key containers are running
    local key_containers=("jellyfin" "caddy" "uptime-kuma", "porkbun-ddns")
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
    
    log "Docker and key containers are healthy"
    return 0
}

# --------------------------------------------------
# Recovery actions
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
        return 0
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
        if cd "$HOMELAB_DIR" && docker compose up -d; then
            log "Docker Compose services started"
            return 0
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
            sleep 30  # Wait for network to stabilize
            return 0
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
    if cd "$HOMELAB_DIR" && docker compose down && docker compose up -d; then
        log "Docker services restarted after cleanup"
        return 0
    else
        log "Failed to restart Docker services after cleanup"
        return 1
    fi
}

reboot_system() {
    log "Initiating system reboot (last resort)..."
    
    # Give notification time to send
    sleep 5
    flush_notifications
    
    # Ensure all data is written to disk
    sync
    
    # Reboot the system
    reboot
}

# --------------------------------------------------
# Main recovery logic with graduated escalation
# --------------------------------------------------
handle_failure() {
    local current_state
    current_state=$(get_current_state)
    
    log "Current escalation state: $current_state"
    
    case "$current_state" in
        0)  # Level 1: Fritz!Box restart (network issues are often root cause)
            log "ESCALATION LEVEL 1: Restarting Fritz!Box"
            notify "🔄 Network Recovery" "Restarting Fritz!Box (Level 1/5)"
            
            if restart_fritzbox; then
                notify "✅ Recovery Success" "Fritz!Box restart resolved the issue"
                set_state 0
                return 0
            else
                set_state 1
                return 1
            fi
            ;;
        1)  # Level 2: Docker services restart
            log "ESCALATION LEVEL 2: Restarting Docker services"
            notify "🔄 Service Recovery" "Restarting Docker services (Level 2/5)"
            
            if restart_docker_services; then
                notify "✅ Recovery Success" "Docker restart resolved the issue"
                set_state 0
                return 0
            else
                set_state 2
                return 1
            fi
            ;;
        2)  # Level 3: Network interface restart
            log "ESCALATION LEVEL 3: Restarting network interface"
            notify "🔄 Network Interface" "Restarting network interface (Level 3/5)"
            
            if restart_network_interface; then
                notify "✅ Recovery Success" "Network interface restart resolved the issue"
                set_state 0
                return 0
            else
                set_state 3
                return 1
            fi
            ;;
        3)  # Level 4: Aggressive Docker cleanup
            log "ESCALATION LEVEL 4: Force Docker restart with cleanup"
            notify "🔄 Deep Cleanup" "Force Docker cleanup and restart (Level 4/5)"
            
            if force_docker_cleanup; then
                notify "✅ Recovery Success" "Docker cleanup resolved the issue"
                set_state 0
                return 0
            else
                set_state 4
                return 1
            fi
            ;;
        4)  # Level 5: System reboot (last resort)
            log "ESCALATION LEVEL 5: System reboot (last resort)"
            notify "🚨 CRITICAL" "System reboot initiated - all other methods failed"
            reboot_system
            ;;
        *)  # Max escalation reached
            log "CRITICAL: Maximum escalation level reached, manual intervention required"
            notify "🚨 MANUAL INTERVENTION" "All automated recovery methods exhausted - manual attention required"
            return 1
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
    log "=== Starting comprehensive health checks ==="
    
    # Check internet connectivity first
    if ! check_internet_connectivity; then
        log "❌ Internet connectivity: FAILED"
        return 1
    fi
    log "✅ Internet connectivity: PASSED"
    
    # External monitoring (primary)
    local external_ok=false
    if check_external_monitor; then
        log "✅ External monitor (BetterStack): HEALTHY"
        external_ok=true
    else
        log "❌ External monitor (BetterStack): UNHEALTHY"
    fi
    
    # Internal monitoring (secondary/validation)
    local internal_ok=false
    if check_internal_monitor; then
        log "✅ Internal monitor (UptimeKuma): HEALTHY"
        internal_ok=true
    else
        log "❌ Internal monitor (UptimeKuma): UNHEALTHY"
    fi
    
    # Docker health (infrastructure)
    local docker_ok=false
    if check_docker_health; then
        log "✅ Docker health: PASSED"
        docker_ok=true
    else
        log "❌ Docker health: FAILED"
    fi
    
    # Evaluate results
    if $external_ok && $internal_ok && $docker_ok; then
        log "🟢 All systems healthy"
        return 0
    elif $external_ok && $internal_ok; then
        log "🟡 Monitors healthy but Docker issues detected"
        return 1
    elif $internal_ok && $docker_ok; then
        log "🟡 Internal systems healthy but external connectivity issues"
        return 1
    else
        log "🔴 Multiple system failures detected"
        return 1
    fi
}

# --------------------------------------------------
# Main execution function
# --------------------------------------------------
main() {
    log "=== HomeLab WatchDog Started (PID: $$) ==="
    
    # Load configuration
    load_credentials
    
    # Install jq if not available (for JSON parsing)
    if ! command -v jq &>/dev/null; then
        log "Installing jq for JSON parsing..."
        apt-get update &>/dev/null && apt-get install -y jq &>/dev/null || log "Warning: Could not install jq, using fallback parsing"
    fi
    
    # Perform health checks
    if perform_health_checks; then
        log "=== All systems healthy ==="
        reset_state_on_success
        log "=== HomeLab WatchDog completed successfully ==="
    else
        log "=== System failures detected - initiating recovery ==="
        if handle_failure; then
            log "=== Recovery successful ==="
        else
            log "=== Recovery failed - escalation continues ==="
        fi
    fi
    
    # Send any queued notifications (grouped together)
    flush_notifications
    
    log "=== HomeLab WatchDog session ended ==="
}

# --------------------------------------------------
# Script execution
# --------------------------------------------------
main "$@"