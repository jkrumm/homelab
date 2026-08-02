#!/usr/bin/env bash
# Automated Garmin token re-login — hybrid proactive + reactive.
#
#   Proactive: refresh every PROACTIVE_DAYS so the token is renewed before it can
#              expire — the container then never goes unhealthy in normal operation
#              (no UptimeKuma / watchdog noise).
#   Reactive:  if the container is already unhealthy (token died earlier than the
#              proactive window), reauth now — but no more often than
#              REATTEMPT_BACKOFF_H, so a Garmin 429 can't cause a login storm.
#   Safety:    relogin_auto.py stashes the current token and restores it on failure,
#              so a failed run never leaves the collector token-less.
#
# Run under `op run --env-file=.env.tpl` (cron) so the `docker compose run` sibling
# inherits GARMIN_* + ARGO_API_TOKEN. Pass --force to reauth unconditionally
# (used by `make garmin-relogin-auto`).
set -euo pipefail

PROACTIVE_DAYS="${PROACTIVE_DAYS:-4}"
REATTEMPT_BACKOFF_H="${REATTEMPT_BACKOFF_H:-6}"
CONTAINER=garmin-collector

# ── Uptime Kuma push heartbeat ────────────────────────────────────────────────
# Standalone (not sourced from homelab-private/scripts/lib.sh) — this is a
# public-repo cron and shouldn't take a runtime dependency on the private repo.
# Push URL read from a plain file, not .env.tpl/op run: this cron runs under
# `op run --env-file=.env.tpl`, which resolves the WHOLE template before exec —
# one unresolvable ref (e.g. a 1Password field that doesn't exist yet) aborts
# every homelab cron, not just this one. A file is created independently of
# any 1Password write, so the monitor can be deployed without touching the
# template. Missing/empty file = silent no-op (an undeployed monitor must not
# break the job), timeout-bounded so a hung ping cannot make a cron run
# overlap the next. Called only on a clean run below — never unconditionally —
# so a missing heartbeat is what alerts.
GARMIN_RELOGIN_PUSH_URL_FILE="${HOME}/.config/uptime-kuma/garmin-relogin-push-url"
heartbeat() {
  local url
  [ -r "$GARMIN_RELOGIN_PUSH_URL_FILE" ] || return
  url="$(cat "$GARMIN_RELOGIN_PUSH_URL_FILE" 2>/dev/null | tr -d '[:space:]')"
  [ -z "$url" ] && return
  curl -fsS --max-time 10 "$url" > /dev/null 2>&1 \
    || echo "$(date -Iseconds) warning: heartbeat ping failed (Uptime Kuma unreachable?)" >&2
}

REPO_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
STATE_DIR="${HOME}/.local/state/garmin-relogin"
mkdir -p "$STATE_DIR"
ATTEMPT_FILE="$STATE_DIR/last-attempt"
SUCCESS_FILE="$STATE_DIR/last-success"

now=$(date +%s)
read_ts() { if [ -f "$1" ]; then cat "$1"; else echo 0; fi; }
last_attempt=$(read_ts "$ATTEMPT_FILE")
last_success=$(read_ts "$SUCCESS_FILE")
proactive_s=$(( PROACTIVE_DAYS * 86400 ))
backoff_s=$(( REATTEMPT_BACKOFF_H * 3600 ))
success_age_d=$(( (now - last_success) / 86400 ))

force=0
[ "${1:-}" = "--force" ] && force=1

health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo missing)

reason=""
if [ "$force" = "1" ]; then
  reason="forced"
elif [ "$health" = "unhealthy" ] && [ $(( now - last_attempt )) -ge "$backoff_s" ]; then
  reason="reactive: container unhealthy"
elif [ $(( now - last_success )) -ge "$proactive_s" ]; then
  reason="proactive: last success ${success_age_d}d ago"
fi

if [ -z "$reason" ]; then
  echo "$(date -Iseconds) skip (health=$health, last success ${success_age_d}d ago)"
  heartbeat
  exit 0
fi

echo "$(date -Iseconds) reauth start — $reason"
echo "$now" > "$ATTEMPT_FILE"

cd "$REPO_DIR"
if docker compose run --rm --user 0:0 "$CONTAINER" python relogin_auto.py \
   && docker compose up -d --force-recreate "$CONTAINER"; then
  echo "$now" > "$SUCCESS_FILE"
  echo "$(date -Iseconds) reauth OK"
  heartbeat
else
  echo "$(date -Iseconds) reauth FAILED — retry after ${REATTEMPT_BACKOFF_H}h backoff" >&2
  exit 1
fi
