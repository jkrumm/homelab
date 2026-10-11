#!/usr/bin/env bash
# WeatherOrb archive pull — brings the mini's staged archive home, verifies it, and
# only then lets the mini delete its copy (weatherorb ADR 0009).
#
# The weatherorb mini stages archive files (past-track forecast runs, database
# dumps, round products, static grids) under its archive root and exposes them
# through a forced-command ssh door: the authorized_keys entry for the dedicated
# key is `restrict,command=…`, so the "command" sent here is only an argument string:
#   index        -> stdout lines "<sha256>  <size>  <relpath>" (two spaces; append-only)
#   get <relpath> -> the file's bytes; exit 3 + "pruned" on stderr if the mini already
#                    deleted it (it does so only after an ack)
#   ack          -> stdin lines "<sha256>  <relpath>"; replies "acked <n> rejected <m>"
#
# Flow per run (jkrumm crontab, hourly :55):
#   1. fetch the index to $DEST/INDEX.mini (tmp + rename)
#   2. per entry: skip if held and recorded in $DEST/.verified; else `get` into
#      <relpath>.part, check size + sha256, rename into place, append to .verified.
#      A mismatch deletes the .part and counts a failure. A "pruned" answer for a file
#      not held locally is a hard failure (data lost): reported, never acked.
#   3. ack every .verified line not yet in .acked in ONE batched call and append the
#      acked ones to .acked, only after the reply parsed. Only files whose hash was
#      verified on local disk after the rename are ever acked.
# Files are immutable and whole-file, so a failed or interrupted run is simply resumed
# by the next one. Nothing in $DEST is ever deleted (append-only, year one); flock
# keeps two runs from overlapping.
#
# DEST is deliberately OUTSIDE the restic-backed /mnt/hdd/backups: this archive is
# large and rebuildable only from the mini, so it has no offsite copy yet. A second
# (offsite) copy is an open owner decision — weatherorb ADR 0009.
#
# Plain user cron, no `op run`. Push URL from a chmod-600 file, same convention as
# weatherorb-accounts-pull.sh — never .env.tpl. Missing file = warning, no ping.
# Key: scripts/weatherorb-archive-keygen.sh. Restore drill:
# scripts/weatherorb-archive-restore-check.sh.
#
#   crontab (jkrumm):  55 * * * * /home/jkrumm/homelab/scripts/weatherorb-archive-pull.sh >> /home/jkrumm/logs/weatherorb-archive-pull.log 2>&1
set -euo pipefail

DEST="${WO_ARCHIVE_DEST:-/mnt/hdd/weatherorb-archive}"
SSH_TARGET="${WO_ARCHIVE_SSH:-jkrumm@mini}"
SSH_PORT="${WO_ARCHIVE_PORT:-22}"
SSH_KEY="${WO_ARCHIVE_KEY:-$HOME/.ssh/id_ed25519_weatherorb_archive}"
PUSH_URL_FILE="${HOME}/.config/uptime-kuma/weatherorb-archive-push-url"

RELPATH_RE='^[A-Za-z0-9._/-]+$'

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

# $@ = door command words. stdin passes through; stderr is the caller's.
door() {
  ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 \
    -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" -p "$SSH_PORT" \
    "$SSH_TARGET" "$@"
}

mkdir -p "$DEST"
touch "$DEST/.verified" "$DEST/.acked"

exec 9> "$DEST/.lock"
if ! flock -n 9; then
  log "another pull holds $DEST/.lock — skipping this run"
  exit 0
fi

index_tmp="$DEST/INDEX.mini.tmp"
errf="$(mktemp)" todo="$(mktemp)" pending="$(mktemp)" unacked="$(mktemp)"
trap 'rm -f "$errf" "$index_tmp" "$todo" "$pending" "$unacked"' EXIT

door index > "$index_tmp" 2> "$errf" || fail "index fetch failed: $(head -c 200 "$errf" | tr '\n' ' ')"
mv "$index_tmp" "$DEST/INDEX.mini"

# Index entries whose "<sha256>  <relpath>" is not yet in .verified. awk keeps this
# linear however large the archive grows; the loop below only walks what is new.
# (FILENAME, not NR == FNR: an empty first file would make awk treat the second as the first.)
awk -F'  ' -v known="$DEST/.verified" 'FILENAME == known { held[$0] = 1; next } !(($1 "  " $3) in held)' \
  "$DEST/.verified" "$DEST/INDEX.mini" > "$todo"

fetched=0 bytes=0
failures=()

while IFS= read -r line <&3; do
  [ -n "$line" ] || continue
  sha="${line%%  *}"
  rest="${line#*  }"
  size="${rest%%  *}"
  rel="${rest#*  }"

  if [[ ! "$sha" =~ ^[0-9a-f]{64}$ ]] || [[ ! "$size" =~ ^[0-9]+$ ]] \
    || [ "$rest" = "$line" ] || [ "$rel" = "$rest" ]; then
    failures+=("malformed index line: ${line:0:80}")
    continue
  fi
  if [[ ! "$rel" =~ $RELPATH_RE ]] || [[ "$rel" == /* ]] || [[ "$rel" == *..* ]]; then
    failures+=("unsafe relpath refused: ${rel:0:80}")
    continue
  fi

  file="$DEST/$rel"
  # Files are immutable: a held, verified file whose index hash now differs is an
  # anomaly to report, never something to overwrite.
  if awk -v r="$rel" 'substr($0, 67) == r { found = 1 } END { exit !found }' "$DEST/.verified"; then
    failures+=("index hash changed for held file: $rel")
    continue
  fi

  # Held but never recorded (a crash between rename and append): verify locally, no refetch.
  if [ -f "$file" ] && [ "$(stat -c %s "$file")" = "$size" ] \
    && [ "$(sha256sum "$file" | cut -d' ' -f1)" = "$sha" ]; then
    printf '%s  %s\n' "$sha" "$rel" >> "$DEST/.verified"
    continue
  fi

  mkdir -p "$(dirname "$file")"
  part="$file.part"
  rc=0
  door get "$rel" > "$part" 2> "$errf" < /dev/null || rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -f "$part"
    if [ "$rc" -eq 3 ] && grep -qi pruned "$errf"; then
      failures+=("DATA LOST: mini pruned $rel before it was held here")
    else
      failures+=("get failed (exit $rc): $rel: $(head -c 120 "$errf" | tr '\n' ' ')")
    fi
    continue
  fi

  got_size="$(stat -c %s "$part")"
  got_sha="$(sha256sum "$part" | cut -d' ' -f1)"
  if [ "$got_size" != "$size" ] || [ "$got_sha" != "$sha" ]; then
    rm -f "$part"
    failures+=("verify mismatch (size $got_size/$size): $rel")
    continue
  fi

  mv "$part" "$file"
  printf '%s  %s\n' "$sha" "$rel" >> "$DEST/.verified"
  fetched=$(( fetched + 1 ))
  bytes=$(( bytes + size ))
done 3< "$todo"

# Ack only what is verified on local disk and not yet acked, in one batched call.
awk -v known="$DEST/.acked" 'FILENAME == known { done[$0] = 1; next } !($0 in done)' "$DEST/.acked" "$DEST/.verified" > "$unacked"
n_pending=0 acked=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  if [ ! -f "$DEST/${line#*  }" ]; then
    failures+=("verified file missing, not acking: ${line#*  }")
    continue
  fi
  echo "$line" >> "$pending"
  n_pending=$(( n_pending + 1 ))
done < "$unacked"

if [ "$n_pending" -gt 0 ]; then
  reply="$(door ack < "$pending" 2> "$errf")" \
    || fail "ack failed: $(head -c 200 "$errf" | tr '\n' ' ')"
  if [[ "$reply" =~ ^acked[[:space:]]+([0-9]+)[[:space:]]+rejected[[:space:]]+([0-9]+)$ ]]; then
    if [ "${BASH_REMATCH[2]}" -eq 0 ] && [ "${BASH_REMATCH[1]}" -eq "$n_pending" ]; then
      cat "$pending" >> "$DEST/.acked"
      acked="$n_pending"
    else
      # Which lines were rejected is not reported, so none is recorded: the next run re-sends all.
      failures+=("ack reply '$reply' for $n_pending files — nothing recorded as acked")
    fi
  else
    failures+=("unparseable ack reply: ${reply:0:80}")
  fi
fi

held="$(wc -l < "$DEST/.verified" | tr -d ' ')"
summary="fetched $fetched files ($(numfmt --to=iec "$bytes")), $acked acked, ${#failures[@]} failures, $held held"

if [ "${#failures[@]}" -gt 0 ]; then
  for f in "${failures[@]}"; do log "failure: $f"; done
  fail "$summary — ${failures[0]}"
fi

log "OK: $summary"
heartbeat up "$summary"
