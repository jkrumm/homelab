#!/usr/bin/env bash
# Restic repository integrity check → Uptime Kuma heartbeat.
#
# Runs `restic check` inside the restic-backup container (its append-only key reads
# the B2 repo) and pushes the result to a Kuma push monitor:
#   weekly  — structure only: index, snapshots, trees (no pack data download)
#   subset  — structure plus a slice of the pack data (`--read-data-subset=N/24`).
#             Run on the 1st and 15th, so the slice number walks 1..24 over a year
#             and every pack in the repository is read back once a year.
#
# `--no-lock`: the append-only key cannot delete, so a backup killed mid-run (a deploy
# recreating the container, a reboot) leaves its lock file in the repo forever, and
# `restic check` without `--no-lock` wants an exclusive lock that any such stale lock
# refuses. check is read-only and prune is a manual master-key job (docs/backups.md),
# so reading unlocked is safe.
#
# Push URLs: chmod-600 plain files, never .env.tpl (same convention as
# immich-backup-check.sh):
#   ~/.config/uptime-kuma/restic-check-weekly-push-url
#   ~/.config/uptime-kuma/restic-check-subset-push-url
#
#   crontab (jkrumm):
#     0 10 * * 0     /home/jkrumm/homelab/scripts/restic-check.sh weekly >> /home/jkrumm/logs/restic-check.log 2>&1
#     0 10 1,15 * *  /home/jkrumm/homelab/scripts/restic-check.sh subset >> /home/jkrumm/logs/restic-check.log 2>&1
set -euo pipefail

command -v jq > /dev/null || { echo "restic-check: jq missing" >&2; exit 2; }
CONTAINER="${RESTIC_CONTAINER:-restic-backup}"
CONFIG_DIR="${HOME}/.config/uptime-kuma"
mode="${1:-}"

log() { echo "$(date -Iseconds) restic-check[$mode] $*"; }

case "$mode" in
  weekly)
    args=()
    push_file="$CONFIG_DIR/restic-check-weekly-push-url"
    ;;
  subset)
    # 24 slices a year: slice = 2 * (month - 1) + (1 for the 1st half, 2 for the 15th on)
    month=$((10#$(date +%m)))
    half=1
    [ $((10#$(date +%d))) -ge 15 ] && half=2
    slice=$((2 * (month - 1) + half))
    args=("--read-data-subset=${slice}/24")
    push_file="$CONFIG_DIR/restic-check-subset-push-url"
    ;;
  *)
    echo "usage: $0 weekly|subset" >&2
    exit 2
    ;;
esac

heartbeat() { # heartbeat up|down <msg>
  local url
  [ -r "$push_file" ] || { log "warning: no push URL file at $push_file — monitor not wired"; return 0; }
  url="$(tr -d '[:space:]' < "$push_file")"
  [ -n "$url" ] || return 0
  curl -fsS --max-time 15 --retry 3 --get --data-urlencode "status=$1" --data-urlencode "msg=$2" "$url" > /dev/null 2>&1 \
    || log "warning: heartbeat ping failed (Uptime Kuma unreachable?)"
}

out="$(mktemp)"
trap 'rm -f "$out"' EXIT

start="$(date +%s)"
log "start: restic check --no-lock ${args[*]:-}"
rc=0
docker exec "$CONTAINER" restic check --no-lock "${args[@]}" > "$out" 2>&1 || rc=$?
cat "$out"
secs=$(( $(date +%s) - start ))

if [ "$rc" -ne 0 ]; then
  log "FAIL: restic check exit $rc after ${secs}s"
  heartbeat down "restic check exit ${rc} (${args[*]:-structure}): $(tail -n 3 "$out" | tr '\n' ' ' | cut -c1-200)"
  exit 1
fi

# A lock older than STALE_LOCK_H is a leftover of a killed run (a live backup refreshes its
# lock every few minutes). It makes the nightly `restic forget` fail with "repo already
# locked" ("Forget failed" in the backup log, backup still exits 0), so retention silently
# stops. The append-only key cannot remove it: `make restic-unlock` from the Mac does.
STALE_LOCK_H="${STALE_LOCK_H:-36}"
now="$(date +%s)"
stale=0
for id in $(docker exec "$CONTAINER" restic list locks --no-lock 2>/dev/null); do
  t="$(docker exec "$CONTAINER" restic cat lock "$id" --no-lock 2>/dev/null | jq -r '.time // empty')"
  [ -n "$t" ] || continue
  if [ $(( now - $(date -d "$t" +%s) )) -gt $(( STALE_LOCK_H * 3600 )) ]; then
    log "stale repo lock ${id:0:8} from $t"
    stale=$((stale + 1))
  fi
done
if [ "$stale" -gt 0 ]; then
  log "FAIL: $stale stale repo lock(s) older than ${STALE_LOCK_H}h — nightly forget is blocked; run 'make restic-unlock' from the Mac"
  heartbeat down "$stale stale repo lock(s): nightly forget blocked, run make restic-unlock from the Mac"
  exit 1
fi

log "OK: restic check ${args[*]:-structure} in ${secs}s"
heartbeat up "ok ${args[*]:-structure} ${secs}s"
