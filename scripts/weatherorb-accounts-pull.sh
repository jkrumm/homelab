#!/usr/bin/env bash
# WeatherOrb account-DB pull — brings the VPS's hourly pg_dump home and proves it.
#
# The WeatherOrb account database (passkeys, sessions, favourites, settings —
# weatherorb ADR 0013) lives on the VPS. An hourly VPS cron (:15) writes
#   /var/backups/weatherorb-accounts/weatherorb_accounts-<UTC %Y%m%dT%H%MZ>.dump
# (pg_dump --format=custom, newest 48 kept), readable only by the unprivileged
# user `wo-backup`. This script (jkrumm crontab, :25) pulls them over Tailscale
# SSH as wo-backup@vps into /mnt/hdd/backups/weatherorb-accounts/ — inside the
# restic-backed /mnt/hdd/backups source, so every dump also goes offsite to B2 —
# then
#   - the newest local dump must be younger than MAX_AGE_H,
#   - it must pass `pg_restore --list` (a dump killed mid-write fails the TOC read),
#   - dumps older than KEEP_DAYS are deleted (only after both checks passed),
# and pings "WeatherOrb Accounts Backup - Push" with status=up. Any failure pings
# status=down with a message and exits nonzero. rsync has no --delete: the VPS
# keeps 48 hours, this side keeps KEEP_DAYS.
#
# Plain user cron, no `op run`. Push URL from a chmod-600 file, same convention
# as immich-backup-check.sh — never .env.tpl. Missing file = warning, no ping.
# Restore drill: scripts/weatherorb-accounts-restore-check.sh.
#
#   crontab (jkrumm):  25 * * * * /home/jkrumm/homelab/scripts/weatherorb-accounts-pull.sh >> /home/jkrumm/logs/weatherorb-accounts-pull.log 2>&1
set -euo pipefail

REMOTE="${WO_REMOTE:-wo-backup@vps:/var/backups/weatherorb-accounts/}"
DEST_DIR="${WO_DEST_DIR:-/mnt/hdd/backups/weatherorb-accounts}"
MAX_AGE_H="${MAX_AGE_H:-2}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG_IMAGE="${PG_IMAGE:-postgres:18}"
PUSH_URL_FILE="${HOME}/.config/uptime-kuma/weatherorb-accounts-push-url"

log() { echo "$(date -Iseconds) $*"; }

# $1 = up|down, $2 = message. Never fails the script: a dead Kuma must not mask
# the real result, and its missing heartbeat is what alerts anyway.
heartbeat() {
  local status="$1" msg="$2" url
  [ -r "$PUSH_URL_FILE" ] || { log "warning: no push URL file at $PUSH_URL_FILE — monitor not wired" >&2; return 0; }
  url="$(tr -d '[:space:]' < "$PUSH_URL_FILE")"
  [ -z "$url" ] && return 0
  curl -fsS --max-time 10 -G \
    --data-urlencode "status=$status" --data-urlencode "msg=$msg" \
    "${url%%\?*}" > /dev/null 2>&1 \
    || log "warning: heartbeat ping failed (Uptime Kuma unreachable?)" >&2
}

fail() {
  log "FAIL: $*"
  heartbeat down "$*"
  exit 1
}

mkdir -p "$DEST_DIR"

if ! rsync -a --timeout=120 \
  --include='weatherorb_accounts-*.dump' --exclude='*' \
  -e "ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new" \
  "$REMOTE" "$DEST_DIR/"; then
  fail "rsync from VPS failed"
fi

newest="$(find "$DEST_DIR" -maxdepth 1 -name 'weatherorb_accounts-*.dump' -printf '%T@ %p\n' \
  | sort -rn | head -1 | cut -d' ' -f2-)"
[ -n "$newest" ] || fail "no weatherorb_accounts-*.dump in $DEST_DIR"

age_s=$(( $(date +%s) - $(stat -c %Y "$newest") ))
if [ "$age_s" -gt $(( MAX_AGE_H * 3600 )) ]; then
  fail "newest dump is $(( age_s / 60 )) min old (> ${MAX_AGE_H}h): $(basename "$newest")"
fi

toc="$(docker run --rm -i "$PG_IMAGE" pg_restore --list < "$newest" 2>&1)" \
  || fail "pg_restore --list failed (truncated dump?): $(basename "$newest")"
grep -q 'TABLE DATA' <<< "$toc" \
  || fail "dump has no TABLE DATA entries: $(basename "$newest")"

find "$DEST_DIR" -maxdepth 1 -name 'weatherorb_accounts-*.dump' -mtime "+$KEEP_DAYS" -delete

msg="$(basename "$newest") ($(( age_s / 60 )) min old, $(du -h "$newest" | cut -f1))"
log "OK: $msg"
heartbeat up "$msg"
