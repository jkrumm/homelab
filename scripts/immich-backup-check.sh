#!/usr/bin/env bash
# Immich DB backup heartbeat — proves last night's pg_dump exists and is whole.
#
# Immich's built-in backup job (02:00, Administration → Settings → Backup) writes
# upload/backups/immich-db-backup-<ts>-v<immich>-pg<ver>.sql.gz and pushes
# nothing. That dump is the ONLY copy of albums, people, sharing and metadata
# edits (CLAUDE.md "Immich database"), so this cron checks it and pings
# "Immich Backup - Push" only when the newest dump is
#   - younger than MAX_AGE_H,
#   - a valid gzip stream (a container killed mid-dump leaves a truncated file),
#   - terminated by pg_dump's "PostgreSQL database dump complete" trailer.
# No ping on any failure — a missing heartbeat is what alerts. Restic ships the
# file offsite regardless; this is about whether the file is worth shipping.
#
# Plain user cron, no `op run`: it only reads a directory. Push URL from a
# chmod-600 file, same convention as garmin-auto-relogin.sh — never .env.tpl, so
# a not-yet-created 1Password field cannot brick every op-wrapped target.
#
#   crontab (jkrumm):  0 4 * * * /home/jkrumm/homelab/scripts/immich-backup-check.sh >> /home/jkrumm/logs/immich-backup-check.log 2>&1
set -euo pipefail

BACKUP_DIR="${IMMICH_BACKUP_DIR:-$HOME/ssd/SSD/Bilder/immich/upload/backups}"
MAX_AGE_H="${MAX_AGE_H:-26}"
PUSH_URL_FILE="${HOME}/.config/uptime-kuma/immich-backup-push-url"

log() { echo "$(date -Iseconds) $*"; }

heartbeat() {
  local url
  [ -r "$PUSH_URL_FILE" ] || { log "warning: no push URL file at $PUSH_URL_FILE — monitor not wired"; return; }
  url="$(tr -d '[:space:]' < "$PUSH_URL_FILE")"
  [ -z "$url" ] && return
  curl -fsS --max-time 10 "$url" > /dev/null 2>&1 \
    || log "warning: heartbeat ping failed (Uptime Kuma unreachable?)" >&2
}

newest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'immich-db-backup-*.sql.gz' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2-)"
if [ -z "$newest" ]; then
  log "FAIL: no immich-db-backup-*.sql.gz in $BACKUP_DIR"
  exit 1
fi

age_s=$(( $(date +%s) - $(stat -c %Y "$newest") ))
if [ "$age_s" -gt $(( MAX_AGE_H * 3600 )) ]; then
  log "FAIL: newest dump is $(( age_s / 3600 ))h old (> ${MAX_AGE_H}h): $newest"
  exit 1
fi

if ! gzip -t "$newest" 2>/dev/null; then
  log "FAIL: gzip integrity check failed (truncated dump?): $newest"
  exit 1
fi

if ! zcat "$newest" | tail -c 4096 | grep -q "PostgreSQL database dump complete"; then
  log "FAIL: no 'dump complete' trailer — pg_dump did not finish: $newest"
  exit 1
fi

log "OK: $(basename "$newest") ($(( age_s / 3600 ))h old, $(du -h "$newest" | cut -f1))"
heartbeat
