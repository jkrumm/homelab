#!/usr/bin/env bash
# Restic restore drill → Uptime Kuma heartbeat.
#
# Proves the offsite repository can be read back: restores a fixed-size sample of the
# newest snapshot FROM B2 with the append-only key (the one in the restic-backup
# container), hashes it against the live files, and pushes the result.
#
#   1. newest `homelab`-tagged snapshot, its file list (`restic ls --json`)
#   2. per source (the first path segment under /sources): SAMPLE_PER_SOURCE files,
#      chosen by a shuffle seeded with DRILL_SEED (default: today's date, so a run is
#      reproducible and the next one picks other files). Files over MAX_FILE_MIB and
#      names with glob/control characters are not candidates.
#   3. restic restore of exactly those files into a temp dir inside the container
#   4. sha256 of every restored file against the live file under /sources. A live file
#      that changed after the snapshot (mtime newer than the snapshot) or vanished is
#      skipped and named; any other difference fails the run.
#   5. the newest DUMP_GLOB database dump in the snapshot is restored too: `gzip -t`
#      and pg_dump's "dump complete" trailer. No such dump in the snapshot is a note,
#      not a failure. Default: the final Immich dump kept after the
#      retirement (/mnt/hdd/backups/immich-final).
#   6. the temp dir is removed, status pushed: up only if every check passed and at
#      least MIN_VERIFIED files were compared.
#
# DRILL_TAMPER=1 appends a byte to the first restored file before the compare — the
# proof that a mismatch exits non-zero and pushes status=down.
#
# Push URL: ~/.config/uptime-kuma/restic-restore-drill-push-url (chmod 600, plain file).
#
#   crontab (jkrumm):  0 12 1,15 * * /home/jkrumm/homelab/scripts/restic-restore-check.sh >> /home/jkrumm/logs/restic-restore-check.log 2>&1
set -euo pipefail

CONTAINER="${RESTIC_CONTAINER:-restic-backup}"
SAMPLE_PER_SOURCE="${SAMPLE_PER_SOURCE:-3}"
MAX_FILE_MIB="${MAX_FILE_MIB:-64}"
MIN_VERIFIED="${MIN_VERIFIED:-10}"
DRILL_SEED="${DRILL_SEED:-$(date +%Y-%m-%d)}"
DUMP_GLOB="${DUMP_GLOB:-immich-db-final-*.sql.gz}"
PUSH_FILE="${HOME}/.config/uptime-kuma/restic-restore-drill-push-url"

log() { echo "$(date -Iseconds) restic-restore-check $*"; }
dx() { docker exec "$CONTAINER" "$@"; }

heartbeat() { # heartbeat up|down <msg>
  local url
  [ -r "$PUSH_FILE" ] || { log "warning: no push URL file at $PUSH_FILE — monitor not wired"; return 0; }
  url="$(tr -d '[:space:]' < "$PUSH_FILE")"
  [ -n "$url" ] || return 0
  curl -fsS --max-time 15 --retry 3 --get --data-urlencode "status=$1" --data-urlencode "msg=$2" "$url" > /dev/null 2>&1 \
    || log "warning: heartbeat ping failed (Uptime Kuma unreachable?)"
}

work="$(mktemp -d)"
target=""
cleanup() {
  [ -z "$target" ] || dx rm -rf -- "$target" > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  log "FAIL: $*"
  heartbeat down "$*"
  exit 1
}

command -v jq > /dev/null || fail "jq missing on the host"

snap_json="$(dx restic snapshots --no-lock --tag homelab --latest 1 --json)" || fail "restic snapshots failed"
snap="$(jq -r '.[-1].id // empty' <<< "$snap_json")"
[ -n "$snap" ] || fail "no homelab snapshot in the repository"
snap_time="$(jq -r '.[-1].time' <<< "$snap_json")"
snap_epoch="$(date -d "$snap_time" +%s)"
log "snapshot ${snap:0:8} of $snap_time, seed $DRILL_SEED"

# path<TAB>size of every regular file; one pass over the snapshot tree.
max_bytes=$((MAX_FILE_MIB * 1024 * 1024))
dx restic ls --no-lock --json "$snap" > "$work/ls.json" || fail "restic ls $snap failed"
jq -r --argjson max "$max_bytes" '
  select(.struct_type == "node" and .type == "file")
  | select(.size > 0 and .size <= $max)
  | select(.path | test("[][*?\\\\[:cntrl:]]") | not)
  | [.path, .size] | @tsv' "$work/ls.json" > "$work/candidates.tsv"
[ -s "$work/candidates.tsv" ] || fail "snapshot ${snap:0:8} has no candidate files"

# Seeded shuffle, SAMPLE_PER_SOURCE per /sources/<source>/.
seed_num="$(printf '%s' "$DRILL_SEED" | cksum | cut -d' ' -f1)"
awk -F'\t' -v seed="$seed_num" -v per="$SAMPLE_PER_SOURCE" '
  BEGIN { srand(seed) }
  { split($1, seg, "/"); print rand() "\t" seg[3] "\t" $1 }' "$work/candidates.tsv" \
  | sort -k1,1 \
  | awk -F'\t' -v per="$SAMPLE_PER_SOURCE" '{ if (n[$2]++ < per) print $3 }' > "$work/sample.txt"
sample_n="$(wc -l < "$work/sample.txt")"
sources_n="$(awk -F/ '{print $3}' "$work/sample.txt" | sort -u | wc -l)"
log "sample: $sample_n files from $sources_n sources"

# Newest database dump in the snapshot (its name carries a sortable timestamp).
dump_path="$(jq -r --arg glob "$DUMP_GLOB" '
  select(.struct_type == "node" and .type == "file") | .path' "$work/ls.json" \
  | awk -v g="$DUMP_GLOB" 'BEGIN { gsub(/\./, "\\.", g); gsub(/\*/, ".*", g) } { n = split($0, p, "/"); if (p[n] ~ "^" g "$") print p[n] "\t" $0 }' \
  | sort | awk -F'\t' 'END { print $2 }')"

target="$(dx mktemp -d /tmp/restic-drill.XXXXXX)"
include=()
while IFS= read -r p; do include+=(--include "$p"); done < "$work/sample.txt"
[ -z "$dump_path" ] || include+=(--include "$dump_path")

log "restoring into $CONTAINER:$target"
dx restic restore --no-lock "$snap" --target "$target" "${include[@]}" > "$work/restore.log" 2>&1 \
  || { tail -n 5 "$work/restore.log"; fail "restic restore of ${snap:0:8} failed"; }

if [ "${DRILL_TAMPER:-0}" = "1" ]; then
  first="$(sed -n '1p' "$work/sample.txt")"
  log "DRILL_TAMPER: appending a byte to restored $first"
  dx sh -c 'printf x >> "$1"' sh "$target$first"
fi

verified=0
mismatch=0
skipped=0
while IFS= read -r p; do
  restored="$(dx sha256sum -- "$target$p" 2> /dev/null | cut -d' ' -f1)" || true
  if [ -z "$restored" ]; then
    log "MISSING after restore: $p"
    mismatch=$((mismatch + 1))
    continue
  fi
  live_mtime="$(dx stat -c %Y -- "$p" 2> /dev/null)" || live_mtime=""
  if [ -z "$live_mtime" ]; then
    log "skip (gone from the live tree since the snapshot): $p"
    skipped=$((skipped + 1))
    continue
  fi
  if [ "$live_mtime" -gt "$snap_epoch" ]; then
    log "skip (changed after the snapshot): $p"
    skipped=$((skipped + 1))
    continue
  fi
  live="$(dx sha256sum -- "$p" | cut -d' ' -f1)"
  if [ "$restored" = "$live" ]; then
    verified=$((verified + 1))
  else
    log "MISMATCH: $p restored=$restored live=$live"
    mismatch=$((mismatch + 1))
  fi
done < "$work/sample.txt"
log "files: $verified matched, $mismatch mismatched, $skipped skipped"

dump_note="no dump matching $DUMP_GLOB in the snapshot"
if [ -n "$dump_path" ]; then
  dump_file="$target$dump_path"
  if dx gzip -t "$dump_file" 2> /dev/null \
    && dx sh -c 'zcat "$1" | tail -c 4096 | grep -q "PostgreSQL database dump complete"' sh "$dump_file"; then
    dump_note="dump $(basename "$dump_path") gzip-valid with the complete trailer"
  else
    log "DUMP BAD: $dump_path (gzip -t or trailer failed)"
    mismatch=$((mismatch + 1))
    dump_note="dump $(basename "$dump_path") BAD"
  fi
fi
log "$dump_note"

[ "$mismatch" -eq 0 ] || fail "restore drill ${snap:0:8}: $mismatch mismatch(es), $verified matched"
[ "$verified" -ge "$MIN_VERIFIED" ] || fail "restore drill ${snap:0:8}: only $verified files compared (< $MIN_VERIFIED)"

log "OK: snapshot ${snap:0:8}, $verified files sha256-identical to the live tree from $sources_n sources, $dump_note"
heartbeat up "ok ${snap:0:8} ${verified} files, ${dump_note}"
