#!/usr/bin/env bash
# Converge the low-weight BuildKit builder and make it the current one for this user.
#
# Why: `docker build` / `docker compose build` run in BuildKit inside dockerd, i.e. in
# system.slice at the same weight as the containers; the user.slice weight
# (config/systemd/user-slice-batch.conf) does not reach them. A `compose build --no-cache`
# held all 4 cores for minutes (2026-11-14, Issue 1148: load 28-44, ntfy health 2.7 s).
# A docker-container builder is itself a container, so `cpu-shares=20` gives it cgroup
# weight 1 against 100 for every other container: under contention the stack wins, an idle
# host builds at full speed. Rationale and rollback: docs/decisions.md.
#
# Idempotent; run as the user that runs builds (jkrumm): `make builder-setup`.
set -euo pipefail

BUILDER="lowprio"

if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER" --driver docker-container \
    --driver-opt cpu-shares=20 --driver-opt default-load=true >/dev/null
fi
docker buildx inspect "$BUILDER" --bootstrap >/dev/null
docker buildx use "$BUILDER"
echo "buildx builder: $BUILDER (current)"
