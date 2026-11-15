#!/usr/bin/env bash
# scripts/verify-monitors.sh against fixture monitor lists — local, no network.
# DOWN active leaf: exit 1 and named. Paused DOWN, a group DOWN, a push monitor
# with no beat yet and PENDING: exit 0. Empty / not a list: exit 1.

set -uo pipefail

cd "$(dirname "$0")/.." || exit

command -v jq >/dev/null || { echo "skip: jq not installed"; exit 0; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
bad=0

check() { # name, expected rc, expected output substring, json
  local name="$1" want="$2" needle="$3" json="$4" out rc
  printf '%s' "$json" >"$tmp/m.json"
  out="$(bash scripts/verify-monitors.sh "$tmp/m.json" 2>&1)"
  rc=$?
  if [ "$rc" -ne "$want" ] || ! grep -qF -- "$needle" <<<"$out"; then
    echo "FAIL: $name: rc=$rc (want $want), output: $out"
    bad=1
  fi
}

m() { # id name type active status lastBeatAt(json)
  printf '{"id":"%s","name":"%s","type":"%s","active":%s,"status":%s,"lastBeatAt":%s}' "$1" "$2" "$3" "$4" "$5" "$6"
}
list() { printf '{"status":"ready","monitors":[%s]}' "$(IFS=,; echo "$*")"; }

up="$(m 1 up-mon http true 1 '"2026-11-15T12:00:00Z"')"

check "all up" 0 "OK: none of 1 active" "$(list "$up")"
check "active DOWN leaf" 1 "  2 dead-mon" "$(list "$up" "$(m 2 dead-mon http true 0 '"2026-11-15T12:00:00Z"')")"
check "DOWN push with a beat" 1 "  3 push-down" "$(list "$up" "$(m 3 push-down push true 0 '"2026-11-15T12:00:00Z"')")"
check "paused DOWN is ignored" 0 "OK:" "$(list "$up" "$(m 4 paused http false 0 '"2026-11-15T12:00:00Z"')")"
check "DOWN group is ignored" 0 "OK:" "$(list "$up" "$(m 5 grp group true 0 '"2026-11-15T12:00:00Z"')")"
check "push with no beat is not yet due" 0 "OK:" "$(list "$up" "$(m 6 fresh push true 0 null)")"
check "PENDING is a note, not a failure" 0 "pending (retrying): slow" "$(list "$up" "$(m 7 slow http true 2 '"2026-11-15T12:00:00Z"')")"
check "empty list fails" 1 "no monitor list" '{"status":"ready","monitors":[]}'
check "not a list fails" 1 "no monitor list" '{"error":"unauthorized"}'

[ "$bad" -eq 0 ] && echo "ok: verify-monitors.sh"
exit "$bad"
