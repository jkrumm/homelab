#!/usr/bin/env bash
# Hysteresis of the watchdog's CPU temperature alert: one notification when the mean of the
# last 3 readings reaches 90 °C, one when it is back under 85 °C, none in between or on a
# short window. The script is sourced with a fake hwmon tree; notify is a recording stub.
# Local only — no server, no network, no root.

set -uo pipefail

cd "$(dirname "$0")/.." || exit

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export WATCHDOG_STATE_DIR="$TMP/state"
export WATCHDOG_HWMON_ROOT="$TMP/hwmon"
mkdir -p "$WATCHDOG_STATE_DIR" "$WATCHDOG_HWMON_ROOT/hwmon0" "$WATCHDOG_HWMON_ROOT/hwmon1"
echo iwlwifi_1 > "$WATCHDOG_HWMON_ROOT/hwmon0/name"
echo 99000 > "$WATCHDOG_HWMON_ROOT/hwmon0/temp1_input"  # a hot wifi chip must not count
echo coretemp > "$WATCHDOG_HWMON_ROOT/hwmon1/name"

# shellcheck source=../scripts/homelab_watchdog.sh
source scripts/homelab_watchdog.sh
set +e

NOTES=""
notify() { NOTES+="$1|"; }

fail=0
# run <name> <expected notifications> <millidegree readings...>: one check_thermal per reading
run() {
  local name="$1" want="$2" t; shift 2
  NOTES=""
  for t in "$@"; do
    echo "$t" > "$WATCHDOG_HWMON_ROOT/hwmon1/temp1_input"
    check_thermal
  done
  if [[ "$NOTES" == "$want" ]]; then echo "ok: $name"; else echo "FAIL: $name (got: '$NOTES', want: '$want')"; fail=1; fi
}
reset() { rm -f "$THERMAL_SAMPLES_FILE" "$THERMAL_ALARM_FILE"; }
HOT="🌡️ HomeLab CPU hot|"
COOL="🌡️ HomeLab CPU cool again|"

reset; run "a short window never alerts" "" 99000 99000
reset; run "a mean under 90 stays quiet" "" 88000 90000 91000
reset; run "the mean reaching 90 alerts once" "$HOT" 90000 90000 90000 90000 90000
reset; run "flapping around 90 after the alert stays quiet" "$HOT" 91000 91000 91000 89000 91000 89000 90000 89000
reset; run "89.5 to 90.5 around the threshold alerts once" "$HOT" 90500 89500 90500 89500 90500 89500 90500
# alarm is still set from the previous run: the mean must fall under 85 to clear it
run "between 85 and 90 does not clear" "" 86000 86000 86000
run "under 85 clears once" "$COOL" 80000 80000 80000 80000
reset; run "hot, cool, hot alerts each crossing" "$HOT$COOL$HOT" 92000 92000 92000 80000 80000 80000 92000 92000 92000
reset; run "an unreadable sensor does nothing" "" "" "n/a"

rm -rf "$WATCHDOG_HWMON_ROOT/hwmon1"
reset; NOTES=""; check_thermal; [[ -z "$NOTES" && ! -e "$THERMAL_SAMPLES_FILE" ]] \
  && echo "ok: no coretemp sensor does nothing" || { echo "FAIL: missing sensor wrote state or notified"; fail=1; }

exit "$fail"
