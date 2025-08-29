#!/bin/bash
set -e

# --------------------------------------------------
# Homelab Watchdog Script
# --------------------------------------------------
# Checks uptime monitor -> decides if homelab is reachable
# Escalates recovery steps if not reachable
# Logs actions and sends Pushover notifications (when internet is back)
# --------------------------------------------------

STATE_FILE="/var/lib/homelab_watchdog/state"
LOG_FILE="/var/log/homelab_watchdog.log"
QUEUE_FILE="/var/lib/homelab_watchdog/pushover_queue"

mkdir -p "$(dirname "$STATE_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
touch "$QUEUE_FILE"

# --- Load credentials ---
CREDS_FILE="/root/.homelab-watchdog-credentials"
if [ ! -f "$CREDS_FILE" ]; then
  echo "ERROR: Credentials file missing: $CREDS_FILE" | tee -a "$LOG_FILE"
  exit 1
fi
source "$CREDS_FILE"

# Required vars from creds
: "${BETTERSTACK_TOKEN:?Missing BETTERSTACK_TOKEN in credentials}"
: "${PUSHOVER_USER_KEY:?Missing PUSHOVER_USER_KEY in credentials}"
: "${PUSHOVER_API_TOKEN:?Missing PUSHOVER_API_TOKEN in credentials}"
: "${FRITZ_USER:?Missing FRITZ_USER in credentials}"
: "${FRITZ_PASSWORD:?Missing FRITZ_PASSWORD in credentials}"

# --- Functions ---
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG_FILE"
}

notify() {
  local title="$1"
  local msg="$2"
  echo "title=$title&message=$msg" >> "$QUEUE_FILE"
}

flush_notifications() {
  if [ ! -s "$QUEUE_FILE" ]; then
    return
  fi

  local msgs
  msgs=$(awk -F'&message=' '{print $2}' "$QUEUE_FILE" | tr '\n' ' ')

  curl -s https://api.pushover.net/1/messages.json \
       -F "token=$PUSHOVER_API_TOKEN" \
       -F "user=$PUSHOVER_USER_KEY" \
       -F "title=Homelab Watchdog" \
       -F "message=$msgs" > /dev/null

  # Queue leeren
  > "$QUEUE_FILE"
}

check_sudo() {
  if [ "$EUID" -ne 0 ]; then
    log "Warning: Script is not running as root, sudo access may be required for future actions."
  else
    log "Script is running as root."
  fi
}

check_monitor() {
  local resp
  resp=$(curl -s -H "Authorization: Bearer $BETTERSTACK_TOKEN" \
           https://uptime.betterstack.com/api/v2/monitors/3000673)

  if echo "$resp" | grep -q '"status":"up"'; then
    return 0   # UP
  elif echo "$resp" | grep -q '"status":"validating"'; then
    log "Monitor status is validating, waiting for next check..."
    return 1
  else
    log "Monitor status indicates DOWN or other: $resp"
    return 1
  fi
}

restart_fritzbox() {
  log "Attempting Fritz!Box reboot..."
  # Beispiel: über UPnP oder Fritz!Box API
  # curl -s -k "http://fritz.box/login_sid.lua?...&reboot=1"
  notify "Homelab Watchdog" "Fritz!Box reboot triggered"
}

restart_docker() {
  log "Restarting Docker service..."
  systemctl restart docker
  notify "Homelab Watchdog" "Docker service restarted"
}

reboot_server() {
  log "Rebooting server..."
  notify "Homelab Watchdog" "Server reboot initiated"
  reboot
}

# --- Main ---
#flush_notifications
#
#if check_monitor; then
#  log "Homelab is UP"
#  echo "0" > "$STATE_FILE"
#else
#  log "Homelab is DOWN"
#  state=$(cat "$STATE_FILE" 2>/dev/null || echo "0")
#
#  case "$state" in
#    0)
#      restart_fritzbox
#      echo "1" > "$STATE_FILE"
#      ;;
#    1)
#      restart_docker
#      echo "2" > "$STATE_FILE"
#      ;;
#    2)
#      reboot_server
#      echo "3" > "$STATE_FILE"
#      ;;
#    *)
#      log "Max escalation reached, manual intervention required."
#      ;;
#  esac
#fi

flush_notifications
check_sudo

if check_monitor; then
  log "Homelab is UP"
  notify "Test Run" "Monitor reports UP"
else
  log "Homelab is DOWN or validating"
  notify "Test Run" "Monitor reports DOWN or validating"
fi

flush_notifications
