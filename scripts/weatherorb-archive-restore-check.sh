#!/usr/bin/env bash
# WeatherOrb archive restore drill — proves one pulled day is intact and restores.
#
# For one UTC date (default: the newest date with a database dump in INDEX.mini):
#   1. re-hashes every held file of that day (past/<date>/**, dumps/<date>/**) against
#      the size and sha256 in $DEST/INDEX.mini — a missing, short or altered file fails
#   2. prints, per past-track round, the file count and bytes
#   3. restores the day's dump into a throwaway postgres container (random password
#      generated at runtime, no published port, always removed on exit) and prints
#      the dump's table-data entries, every table's row count (forecast_point and
#      observation among them) and, per table, the newest value of its first
#      timestamptz column — columns are discovered from information_schema, none is
#      hardcoded
# Exit nonzero on any mismatch or restore failure. The output is the evidence that
# "a day of the weatherorb archive restored on the homelab". Run by hand after
# changes to the archive, and weekly if wanted:
#
#   scripts/weatherorb-archive-restore-check.sh [<YYYY-MM-DD>]
#   crontab (jkrumm, optional):  50 5 * * 0 /home/jkrumm/homelab/scripts/weatherorb-archive-restore-check.sh >> /home/jkrumm/logs/weatherorb-archive-restore-check.log 2>&1
set -euo pipefail

DEST="${WO_ARCHIVE_DEST:-/mnt/hdd/weatherorb-archive}"
PG_IMAGE="${PG_IMAGE:-postgres:18}"
CONTAINER="wo-archive-restore-check-$$"
DB="restore_check"
INDEX="$DEST/INDEX.mini"

log() { echo "$(date -Iseconds) $*"; }
die() { log "FAIL: $*"; exit 1; }

[ -r "$INDEX" ] || die "no readable $INDEX — has the pull run?"

date_arg="${1:-$(awk -F'  ' '$3 ~ /^dumps\/[0-9]{4}-[0-9]{2}-[0-9]{2}\// { split($3, p, "/"); print p[2] }' "$INDEX" | sort -u | tail -1)}"
[[ "$date_arg" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "no dump date in $INDEX and none given (usage: $0 [YYYY-MM-DD])"
log "day: $date_arg (archive: $DEST)"

# 1. Re-hash every held file of the day against the index.
checked=0 bad=0
while IFS= read -r line; do
  sha="${line%%  *}"
  rest="${line#*  }"
  size="${rest%%  *}"
  rel="${rest#*  }"
  case "$rel" in
    past/"$date_arg"/* | dumps/"$date_arg"/*) ;;
    *) continue ;;
  esac
  [[ "$rel" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$rel" != *..* ]] || { log "MISMATCH unsafe relpath: $rel"; bad=$(( bad + 1 )); continue; }
  checked=$(( checked + 1 ))
  file="$DEST/$rel"
  if [ ! -f "$file" ]; then
    log "MISMATCH missing: $rel"; bad=$(( bad + 1 )); continue
  fi
  if [ "$(stat -c %s "$file")" != "$size" ] || [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$sha" ]; then
    log "MISMATCH size/sha256: $rel"; bad=$(( bad + 1 ))
  fi
done < "$INDEX"
[ "$checked" -gt 0 ] || die "no index entries for $date_arg"
[ "$bad" -eq 0 ] || die "$bad of $checked files of $date_arg failed re-hash"
log "re-hash: $checked files of $date_arg match INDEX.mini"

# 2. Past-track rounds of the day: files and bytes.
echo "past-track rounds on $date_arg (round, files, bytes):"
awk -F'  ' -v d="$date_arg" '
  { n = split($3, p, "/") }
  p[1] == "past" && p[2] == d && n >= 4 { files[p[3]]++; bytes[p[3]] += $2 }
  END { for (r in files) printf "  %s  %d  %d\n", r, files[r], bytes[r] }' "$INDEX" | sort
echo

# 3. Restore the day's dump into a throwaway postgres.
dump="$(find "$DEST/dumps/$date_arg" -maxdepth 1 -name '*.dump' 2> /dev/null | sort | tail -1)"
[ -n "$dump" ] && [ -r "$dump" ] || die "no readable dump under $DEST/dumps/$date_arg"
log "dump: ${dump#"$DEST"/} ($(du -h "$dump" | cut -f1))"

trap 'docker rm -fv "$CONTAINER" > /dev/null 2>&1 || true' EXIT

POSTGRES_PASSWORD="$(openssl rand -hex 24)" \
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD \
  --tmpfs /var/lib/postgresql "$PG_IMAGE" > /dev/null

# TCP, not the socket: the image's init phase answers on the socket only, then
# restarts — a socket probe would race the restart.
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres -q && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres -q \
  || die "throwaway postgres did not come up"

echo "dump table data (pg_restore --list):"
docker exec -i "$CONTAINER" pg_restore --list < "$dump" | grep 'TABLE DATA' | sed 's/^/  /' \
  || die "pg_restore --list failed or dump has no TABLE DATA entries"
echo

docker exec "$CONTAINER" createdb -U postgres "$DB"
docker exec -i "$CONTAINER" pg_restore --no-owner --no-acl --exit-on-error -U postgres --dbname "$DB" < "$dump" \
  || die "pg_restore failed"

# Both queries walk information_schema: no table or column name is assumed.
docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<'SQL' || die "post-restore queries failed"
\echo row counts per table
SELECT t.table_schema || '.' || t.table_name AS "table",
       (xpath('/row/c/text()', query_to_xml(
         format('SELECT count(*) AS c FROM %I.%I', t.table_schema, t.table_name),
         false, true, '')))[1]::text::bigint AS "rows"
FROM information_schema.tables t
WHERE t.table_type = 'BASE TABLE'
  AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1;

\echo newest value of the first timestamptz column per table
SELECT c.table_schema || '.' || c.table_name AS "table", c.column_name AS "column",
       (xpath('/row/m/text()', query_to_xml(
         format('SELECT max(%I) AS m FROM %I.%I', c.column_name, c.table_schema, c.table_name),
         false, true, '')))[1]::text AS "newest"
FROM (
  SELECT DISTINCT ON (table_schema, table_name) table_schema, table_name, column_name
  FROM information_schema.columns
  WHERE data_type = 'timestamp with time zone'
    AND table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name, ordinal_position
) c
JOIN information_schema.tables t USING (table_schema, table_name)
WHERE t.table_type = 'BASE TABLE'
ORDER BY 1;

\echo expected tables present?
SELECT n AS expected,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = n
               AND table_schema NOT IN ('pg_catalog', 'information_schema')) AS present
FROM unnest(ARRAY['forecast_point', 'observation']) AS n;
SQL

log "OK: $date_arg — $checked files re-hashed, ${dump#"$DEST"/} restored and queried"
