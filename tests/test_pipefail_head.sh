#!/usr/bin/env bash
# Heartbeat scripts run `set -euo pipefail`. A `<producer> | head -1` there is a
# coin flip: head exits after one line, the producer takes SIGPIPE (141), pipefail
# fails the pipeline and set -e kills the script before it logs or pings. The
# WeatherOrb backup monitor flapped on this for days (2026-11, ~1 run in 3).
# Fails when a pipefail script pipes anything into `head -1` / `head -n 1`.
# Local only — no server, no network.

set -uo pipefail

cd "$(dirname "$0")/.." || exit

bad=0
for f in scripts/*.sh; do
  grep -q 'pipefail' "$f" || continue
  hits="$(grep -nE '\|[[:space:]]*head[[:space:]]+(-n[[:space:]]*1|-1)([[:space:]]|$|\))' "$f" | grep -v '^[0-9]*:[[:space:]]*#' | grep -v '|| true' || true)"
  [ -z "$hits" ] || { echo "FAIL: $f pipes into head -1 under pipefail:"; echo "$hits"; bad=1; }
done

[ "$bad" -eq 0 ] && echo "ok: no head -1 pipelines under pipefail"
exit "$bad"
