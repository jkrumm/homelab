#!/usr/bin/env bash
# Every active, non-group Uptime Kuma monitor must not be DOWN.
#
# The status page `make verify` reads lists only the HomeLab group, so a monitor
# outside it can sit DOWN unseen (2026-11-15: 12 DOWN, verify reported healthy).
# The full live list comes from Argo on this host (no socket.io, which times out
# when Kuma is CPU-starved): GET /api/uptime-kuma/monitors, status 0 DOWN,
# 1 UP, 2 PENDING, 3 MAINT. A push monitor with no beat yet (lastBeatAt null)
# is not yet due, never DOWN. PENDING is a retry in flight: printed, not failed.
#
# Usage: verify-monitors.sh [monitors.json]   (a file replaces the Argo fetch — tests)
# Env:   ARGO_URL (default http://127.0.0.1:7737), ARGO_TOKEN (default: secrets-run read op://common/api/SECRET)
# Exit:  0 none DOWN, 1 DOWN monitors or the list could not be read.

set -uo pipefail

command -v jq >/dev/null || { echo "UNHEALTHY: jq is required for the monitor check"; exit 1; }

if [ $# -ge 1 ]; then
  resp="$(cat "$1")" || { echo "UNHEALTHY: cannot read $1"; exit 1; }
else
  token="${ARGO_TOKEN:-}"
  if [ -z "$token" ]; then
    command -v secrets-run >/dev/null || { echo "UNHEALTHY: monitor check needs ARGO_TOKEN or secrets-run (runs on the Mac mini, where Argo is)"; exit 1; }
    token="$(secrets-run read op://common/api/SECRET)" || { echo "UNHEALTHY: could not read the Argo token"; exit 1; }
  fi
  resp="$(curl -fsS --max-time 60 -H "Authorization: Bearer $token" "${ARGO_URL:-http://127.0.0.1:7737}/api/uptime-kuma/monitors")" \
    || { echo "UNHEALTHY: Argo monitor list unreachable (${ARGO_URL:-http://127.0.0.1:7737})"; exit 1; }
fi

echo "$resp" | jq -e '(.monitors | type == "array") and (.monitors | length > 0)' >/dev/null 2>&1 \
  || { echo "UNHEALTHY: Argo returned no monitor list"; exit 1; }

state="$(echo "$resp" | jq -r '.status // "unknown"')"
[ "$state" = "ready" ] || echo "NOTE: Argo monitor list status is '$state' (staleSince=$(echo "$resp" | jq -r '.staleSince // "null"'), lastError=$(echo "$resp" | jq -r '.lastError // "null"'))"

total="$(echo "$resp" | jq '[.monitors[] | select(.active and .type != "group")] | length')"
pending="$(echo "$resp" | jq -r '[.monitors[] | select(.active and .type != "group" and .status == 2) | .name] | join(", ")')"
down="$(echo "$resp" | jq -r '.monitors[] | select(.active and .type != "group" and .status == 0 and ((.type == "push" and .lastBeatAt == null) | not)) | "  \(.id) \(.name)"')"

[ -z "$pending" ] || echo "NOTE: pending (retrying): $pending (informational)"
if [ -n "$down" ]; then
  echo "UNHEALTHY: active monitor(s) DOWN:"
  echo "$down"
  exit 1
fi
echo "OK: none of $total active monitors is DOWN"
