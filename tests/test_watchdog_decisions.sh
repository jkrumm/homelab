#!/usr/bin/env bash
# Decision table of the watchdog's failure analysis. The script is sourced (no side
# effects, no root); every effect (docker, reboot, notify, state) is a recording
# stub, so each case asserts which rungs of the ladder were taken. The internal
# monitor and the Kuma heartbeat run for real against a stubbed `curl`.
# Local only — no server, no network, no root.

set -uo pipefail

cd "$(dirname "$0")/.." || exit

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export WATCHDOG_STATE_DIR="$TMP/state"
mkdir -p "$WATCHDOG_STATE_DIR"

# shellcheck source=../scripts/homelab_watchdog.sh
source scripts/homelab_watchdog.sh
set +e

# The two functions exercised for real; the stubs below must not shadow them.
REAL_FUNCS="$(declare -f check_internal_monitor send_uptime_kuma_heartbeat)"

CALLS=""
STATE=0
URLS=""
CURL_BODY=""

rec() { CALLS+="$1 "; }
log() { :; }
log_quiet() { :; }
notify() { rec notify; }
sleep() { :; }
set_state() { STATE="$1"; rec "state=$1"; }
get_current_state() { echo "$STATE"; }
restart_docker_services() { rec docker_restart; return "${DOCKER_RESTART_RC:-0}"; }
restart_network_interface() { rec nic; return 1; }
force_docker_cleanup() { rec cleanup; return 1; }
reboot_system() { rec reboot; return 1; }
check_mount_integrity() { return 0; }
check_internet_connectivity() { [[ "${INTERNET:-1}" == 1 ]]; }
check_external_monitor() { [[ "${EXTERNAL:-1}" == 1 ]]; }
check_internal_monitor() { [[ "${INTERNAL:-1}" == 1 ]]; }
check_docker_health() { [[ "${DOCKER_OK:-1}" == 1 ]]; }
docker() { rec "docker:$*"; }
systemctl() { :; }
timeout() { shift; "$@"; }
curl() {
  local last="${*: -1}"
  URLS+="$last "
  [[ -n "$CURL_BODY" ]] && printf '%s' "$CURL_BODY"
  return 0
}

fail=0
# scenario <name> <state> <must-contain...> -- <must-not-contain...>
# Scenario inputs come from INTERNET/EXTERNAL/INTERNAL/DOCKER_OK in the environment.
expect() {
  local name="$1" state="$2"; shift 2
  local want=() avoid=() seen_sep=0 w
  for w in "$@"; do
    if [[ "$w" == "--" ]]; then seen_sep=1; continue; fi
    if ((seen_sep)); then avoid+=("$w"); else want+=("$w"); fi
  done
  CALLS=""; STATE="$state"
  analyze_failure_and_recover >/dev/null 2>&1
  local ok=1
  for w in ${want[@]+"${want[@]}"}; do [[ " $CALLS" == *" $w "* ]] || ok=0; done
  for w in ${avoid[@]+"${avoid[@]}"}; do [[ " $CALLS" == *" $w "* ]] && ok=0; done
  if ((ok)); then echo "ok: $name"; else echo "FAIL: $name (calls: $CALLS)"; fail=1; fi
}

# External-only failure: restart the access path once, never escalate off-box
for st in 0 1; do
  EXTERNAL=0 expect "external-only state $st restarts cloudflared+caddy" "$st" \
    "docker:restart cloudflared caddy" -- nic cleanup reboot docker_restart
done
for st in 2 3 4; do
  EXTERNAL=0 expect "external-only state $st holds" "$st" \
    -- nic cleanup reboot docker_restart notify "state=0" "state=1" "state=2" "state=3" "state=4"
  [[ "$STATE" == "$st" ]] || { echo "FAIL: external-only state $st was changed to $STATE"; fail=1; }
done

# Internal-only failure: Docker restart -> cleanup -> reboot, never the NIC
INTERNAL=0 expect "internal-only state 0 restarts docker" 0 docker_restart -- nic cleanup reboot
INTERNAL=0 DOCKER_RESTART_RC=1 expect "internal-only failed restart skips the NIC" 0 docker_restart "state=3" -- nic cleanup reboot
INTERNAL=0 expect "internal-only state 2 cleans up" 2 cleanup -- nic reboot
INTERNAL=0 expect "internal-only state 3 cleans up" 3 cleanup -- nic reboot
INTERNAL=0 expect "internal-only state 4 reboots" 4 reboot -- nic cleanup

# Docker down
DOCKER_OK=0 expect "docker down state 3 cleans up" 3 cleanup -- nic reboot
DOCKER_OK=0 expect "docker down state 0 restarts docker" 0 docker_restart -- cleanup reboot nic
DOCKER_OK=0 expect "docker down state 2 (held by external-only) restarts docker, no reboot" 2 docker_restart -- cleanup reboot nic

# Internet down: NIC rung at 2, reboot at 3 (unchanged)
INTERNET=0 expect "internet down state 2 restarts the NIC" 2 nic -- reboot cleanup
INTERNET=0 expect "internet down state 3 reboots" 3 reboot -- cleanup

# Internal monitor: maintenance and incidents are informational, an invalid response is down
KUMA_OK='{"config":{},"incidents":[{"id":1}],"maintenanceList":[{"id":2}]}'
# A DOWN child monitor in the heartbeat list is informational only
KUMA_DOWN_CHILD='{"config":{},"incidents":[],"maintenanceList":[],"heartbeatList":{"7":[{"status":1},{"status":0}],"8":[{"status":1}]}}'
eval "$REAL_FUNCS"

CURL_BODY="$KUMA_OK"
if check_internal_monitor false; then echo "ok: incidents + maintenance do not fail the internal check"
else echo "FAIL: incidents + maintenance failed the internal check"; fail=1; fi

CURL_BODY="$KUMA_DOWN_CHILD"
if check_internal_monitor false; then echo "ok: a DOWN child monitor does not fail the internal check"
else echo "FAIL: a DOWN child monitor failed the internal check"; fail=1; fi

CURL_BODY='{"incidents":[]}'
if check_internal_monitor false; then echo "FAIL: response without config passed"; fail=1
else echo "ok: invalid response fails the internal check"; fi

CURL_BODY=""
if check_internal_monitor false; then echo "FAIL: empty response passed"; fail=1
else echo "ok: unreachable Kuma fails the internal check"; fi

# Heartbeat: down on the manual flag or state >= 3, up otherwise
_CRED_UPTIME_KUMA="tok"
CURL_BODY=""
heartbeat() {
  URLS=""; STATE="$1"
  send_uptime_kuma_heartbeat
}
for st in 0 1 2; do
  rm -f "$MANUAL_INTERVENTION_FLAG"; heartbeat "$st"
  [[ "$URLS" == *"status=up"* ]] && echo "ok: heartbeat up at state $st" || { echo "FAIL: heartbeat at state $st: $URLS"; fail=1; }
done
for st in 3 4; do
  rm -f "$MANUAL_INTERVENTION_FLAG"; heartbeat "$st"
  [[ "$URLS" == *"status=down"* ]] && echo "ok: heartbeat down at state $st" || { echo "FAIL: heartbeat at state $st: $URLS"; fail=1; }
done
touch "$MANUAL_INTERVENTION_FLAG"; heartbeat 0
[[ "$URLS" == *"status=down"* ]] && echo "ok: heartbeat down on manual flag" || { echo "FAIL: heartbeat with flag: $URLS"; fail=1; }

exit "$fail"
