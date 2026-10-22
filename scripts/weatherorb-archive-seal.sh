#!/usr/bin/env bash
# weatherorb-archive-seal.sh — make every settled file in the WeatherOrb archive immutable.
# Runs as root from weatherorb-archive-seal.timer (config/systemd/, installed by setup.sh).
#
# Why: the archive is append-only (weatherorb ADR 0009) but two writers reach it — the
# hourly ssh pull (weatherorb-archive-pull.sh) and S3 PUTs through VersityGW. VersityGW
# v1.9 posix honours `If-None-Match: *` only for files carrying its `user.etag` xattr, so
# a PUT onto a pulled file silently replaced it (2026-10-22, one file lost). Two layers:
#   1. a missing `user.etag` is backfilled with the file's MD5 (the single-part S3 ETag),
#      so a conditional PUT gets its proper 412;
#   2. `chattr +i` — the kernel refuses any overwrite, rename-over or unlink, whatever the
#      writer and whatever it skips. Directories stay writable so new files still land.
#
# Files are sealed once untouched for SETTLE_MIN minutes. Skipped: dot-entries at the top
# level (pull state, .sgwtmp multipart staging), INDEX.mini (rewritten every pull), *.part.
# Deliberate deletion later needs `chattr -i` first.
set -euo pipefail

DEST="${WO_ARCHIVE_DEST:-/mnt/hdd/weatherorb-archive}"
SETTLE_MIN="${WO_SEAL_SETTLE_MIN:-10}"
RELPATH_RE='^[A-Za-z0-9._/-]+$'

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
# Unmounted HDD: nothing to seal (the bare mountpoint is locked by hdd-mountpoint-guard.sh).
mountpoint -q /mnt/hdd || { echo "/mnt/hdd not mounted — skipping"; exit 0; }
[ -d "$DEST" ] || { echo "no $DEST — skipping"; exit 0; }

todo="$(mktemp)"
trap 'rm -f "$todo"' EXIT

# lsattr prints "<flags> <path>"; the archive's relpath charset has no whitespace, and
# anything outside it is reported instead of sealed.
find "$DEST" -mindepth 1 \( -path "$DEST/.*" -o -path "$DEST/INDEX.mini*" \) -prune \
  -o -type f ! -name '*.part' -mmin "+$SETTLE_MIN" -print0 \
  | xargs -0 -r lsattr -d -- \
  | awk '$1 !~ /i/ { print $2 }' > "$todo"

odd=0
while IFS= read -r f; do
  rel="${f#"$DEST"/}"
  [[ "$rel" =~ $RELPATH_RE ]] || { echo "unexpected name, not sealed: ${rel:0:80}" >&2; odd=$((odd + 1)); }
done < "$todo"
[ "$odd" -eq 0 ] || exit 1

n="$(wc -l < "$todo" | tr -d ' ')"
[ "$n" -gt 0 ] || { echo "nothing to seal"; exit 0; }

python3 -I - "$todo" <<'PY'
import hashlib, os, sys
backfilled = 0
for path in open(sys.argv[1]).read().split("\n"):
    if not path or "user.etag" in os.listxattr(path):
        continue
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    os.setxattr(path, "user.etag", f'"{h.hexdigest()}"'.encode())
    backfilled += 1
print(f"etag backfilled on {backfilled} files")
PY

tr '\n' '\0' < "$todo" | xargs -0 -r chattr +i --
echo "sealed $n files"
