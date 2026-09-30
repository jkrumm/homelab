#!/usr/bin/env bash
# WeatherOrb account-DB restore drill — proves the newest pulled dump restores.
#
# Takes the newest weatherorb_accounts-*.dump from the local pull directory
# (scripts/weatherorb-accounts-pull.sh), restores it into a throwaway postgres
# container with a password generated at runtime, and prints row counts plus the
# newest signup. The output is the evidence that "a dump restored on the
# homelab". The container (and its tmpfs data dir) is always removed on exit.
# Run by hand after changes to the account schema, and weekly if wanted:
#
#   scripts/weatherorb-accounts-restore-check.sh [path/to/dump]
#   crontab (jkrumm, optional):  40 5 * * 0 /home/jkrumm/homelab/scripts/weatherorb-accounts-restore-check.sh >> /home/jkrumm/logs/weatherorb-accounts-restore-check.log 2>&1
set -euo pipefail

DEST_DIR="${WO_DEST_DIR:-/mnt/hdd/backups/weatherorb-accounts}"
PG_IMAGE="${PG_IMAGE:-postgres:18}"
CONTAINER="wo-restore-check-$$"
DB="restore_check"

log() { echo "$(date -Iseconds) $*"; }

dump="${1:-$(find "$DEST_DIR" -maxdepth 1 -name 'weatherorb_accounts-*.dump' -printf '%T@ %p\n' \
  | sort -rn | head -1 | cut -d' ' -f2-)}"
[ -n "$dump" ] && [ -r "$dump" ] || { log "FAIL: no readable dump (looked in $DEST_DIR)"; exit 1; }

trap 'docker rm -fv "$CONTAINER" > /dev/null 2>&1 || true' EXIT

log "dump: $(basename "$dump") ($(du -h "$dump" | cut -f1))"

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
  || { log "FAIL: throwaway postgres did not come up"; exit 1; }

docker exec "$CONTAINER" createdb -U postgres "$DB"
docker exec -i "$CONTAINER" pg_restore --no-owner --no-acl -U postgres --dbname "$DB" < "$dump"

docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<'SQL'
SELECT 'user' AS "table", count(*) AS "rows" FROM "user"
UNION ALL SELECT 'passkey', count(*) FROM passkey
UNION ALL SELECT 'session', count(*) FROM session
UNION ALL SELECT 'favourite', count(*) FROM favourite
UNION ALL SELECT 'user_settings', count(*) FROM user_settings;
SELECT max("createdAt") AS newest_user_created_at FROM "user";
SQL

log "OK: $(basename "$dump") restored and queried"
