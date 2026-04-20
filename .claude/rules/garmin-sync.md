---
paths:
  - packages/garmin-sync/**
---

# Garmin Sync Patterns

Python sidecar that syncs Garmin Connect daily health metrics to the shared SQLite DB.

## Architecture

- **Not a web service** — pure cron-style loop (`while True: sync(); sleep(6h)`)
- Shares SQLite DB with the Elysia API via Docker volume mount (`/app/data/homelab.db`)
- Token persistence on SSD volume (`/home/jkrumm/ssd/garmin-tokens/`)
- Logs to stdout — Dozzle picks them up automatically
- UptimeKuma push monitor pings on each cycle (up/down based on error count)

## Garmin Connect Auth Gotchas

- **MFA required on first login** — must run interactively once locally, then copy tokens to server
- **Token refresh** — `python-garminconnect` handles auto-refresh via `tokenstore` directory
- **Garmin rate limits** — mobile SSO login endpoints return 429 if hammered. Wait 5-10 min after failures
- **Auth breakage** — Garmin periodically changes their SSO flow. The `python-garminconnect` library tracks this closely (2k+ stars, actively maintained). Pin to `>=0.2.25` not exact version
- **Re-auth procedure**: run `explore.py` locally with credentials → MFA prompt → tokens saved to `~/.garminconnect/` → `scp` to `homelab:~/ssd/garmin-tokens/` → `make garmin-restart`

## Data Model

- **`daily_metrics`** table: 33 nullable metric columns + `completed` flag + `synced_at`
- **Rolling 7-day backfill**: each cycle fetches today + last 7 days
- **Skip completed days**: rows with `completed=1` are not re-fetched (saves API calls)
- **Upsert preserves existing data**: new null values never overwrite existing non-null values
- **`completed` flag**: set to 1 when the day ended >6h ago (buffer for late Garmin watch syncs)

## Field Mapping (Garmin API → SQLite columns)

Key nested paths that are easy to get wrong:
- Sleep score: `sleep_data.dailySleepDTO.sleepScores.overall.value` (NOT `overallScore` which is always null)
- HRV: `hrv_data.hrvSummary.lastNightAvg` (nested under `hrvSummary`)
- VO2 Max: `max_metrics[0].generic.vo2MaxPreciseValue` (list response, only present on cardio activity days)
- Body battery: in `stats` response (NOT in `all_day_stress`)
- SpO2: requires watch setting enabled (Settings → Sensors → Pulse Ox → During Sleep)

## SQLite Concurrent Access

Both the API (Bun/Drizzle) and garmin-sync (Python/sqlite3) write to the same DB file:
- WAL mode enabled in both processes
- `busy_timeout=30000` in Python to handle lock contention
- Garmin-sync writes are infrequent (every 6h, ~8 rows) so contention is minimal

## Deployment

- `make garmin-deploy` — git pull + rebuild + restart (use after code changes)
- `make garmin-restart` — just restart (use after 1Password secret changes)
- Watchtower opted-out (local build)
- Docker healthcheck: verifies DB file was modified within last 24h
