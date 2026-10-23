# Backups (Restic → Backblaze B2)

**Repo:** `s3:https://s3.eu-central-003.backblazeb2.com/jkrumm/backups/homelab/restic`
**Schedule:** Daily 03:30 (container cron, `BACKUP_CRON` env)
**Retention (forget, automated):** `keep-daily 14, keep-weekly 8, keep-monthly 12, keep-yearly 5`
**Container:** `mazzolino/restic` — see `restic-backup` service in `docker-compose.yml`
**Excludes:** `restic-excludes.txt` at repo root

> ⚠ **Editing the excludes file requires `make restic-deploy`.** It is bind-mounted as a
> single file (`./restic-excludes.txt:/excludes.txt:ro`), so Docker binds the *inode* — and
> `git pull` replaces the file rather than editing in place. After a pull the host file is
> new but the container still reads the old inode, so exclude changes silently do nothing
> until the container is recreated. Verify with:
> `docker exec restic-backup tail -3 /excludes.txt`

## Sources backed up

| Path | Mounts as | Note |
| - | - | - |
| `/home/jkrumm/ssd/SSD/Bilder` | `/sources/Bilder` | All photos incl. Immich subfolder — originals + Immich's nightly DB dumps (see below) |
| `/home/jkrumm/ssd/SSD/Dokumente` | `/sources/Dokumente` | Includes `Obsidian/` sync target |
| `/home/jkrumm/ssd/SSD/Bücher` | `/sources/Buecher` | |
| `/home/jkrumm/ssd/SSD/Videos` | `/sources/Videos` | |
| `/home/jkrumm/ssd/SSD/Public` | `/sources/Public` | Ex-dufs public files (service retired 2026-10-19, data kept) |
| `/home/jkrumm/ssd/SSD/Dev` | `/sources/Dev` | Static files (no node_modules) |
| `/mnt/hdd/fuji/RAWs` | `/sources/Fuji-RAWs` | ~118 GB Fuji RAW archive |
| `/mnt/hdd/backups` | `/sources/hermes-backup` | Daily Hermes Agent backup (Mac Mini → SSH-pushed) + `weatherorb-accounts/` hourly VPS DB dumps (see "WeatherOrb account database" below) |
| `/mnt/hdd/karakeep/data` | `/sources/Karakeep` | Karakeep SQLite DB + crawled assets (Meili index excluded — rebuildable) |
| `/home/jkrumm/ssd/proton-bridge` | `/sources/ProtonBridge` | Proton Bridge vault + gpg keyring + pass store (gluon message cache excluded — re-synced; see `docs/proton-bridge.md`) |

**Skipped intentionally:** Immich raw Postgres data dir (`Bilder/immich/postgres` — excluded; a filesystem copy of a live PGDATA is not restorable, see "Immich database" below), UptimeKuma data (IaC), Caddy/Beszel/Dozzle/FileBrowser state, all homelab-private container state, `/mnt/hdd/Filme`, `/mnt/transfer/*`, `/mnt/hdd/fuji/Videos`, argo SQLite (lives on VPS — backed up alongside VPS Postgres dump cron).

## Immich database — how it's actually backed up

The Immich DB is **not** covered by copying its data directory (that dir is excluded).
It is covered by **Immich's built-in automatic database backup**, which is enabled by
default and needs no cron of ours:

- Immich runs `pg_dump` nightly at 02:00 and writes
  `immich-db-backup-<ts>-v<immich>-pg<ver>.sql.gz` to `upload/backups/`.
- Retention: last 14 dumps (Administration → Settings → Backup).
- That path sits inside the restic-backed `Bilder` tree and is deliberately **not**
  excluded → every dump goes offsite to B2 with the nightly 03:30 restic run.
- **Immich pushes nothing**, so `scripts/immich-backup-check.sh` (jkrumm crontab,
  04:00) proves the newest dump is <26h old, gzip-valid and carries pg_dump's
  "dump complete" trailer, then pings `Immich Backup - Push` (id=228). Push URL
  in `~/.config/uptime-kuma/immich-backup-push-url` (chmod 600) — the plain-file
  convention, never `.env.tpl`.

**Why this matters:** the photo originals are recoverable on their own, but the DB is
what holds albums, folder structure, sharing/partner permissions, people/face names,
favorites and metadata edits — none of which can be reconstructed from the image files.
The dumps are the only thing protecting that.

**Restore / rollback.** Immich downgrades are unsupported and schema migrations are
irreversible, so reverting a version means restoring a dump, not re-pinning an image:
either Administration → Maintenance → Restore database backup (v3+, creates a restore
point first), or the CLI path — stop the stack, wipe `Bilder/immich/postgres`, bring up
a clean stack on the dump's Immich version, then pipe the dump into `psql`. The dump
filename records the Immich + Postgres version it came from. Restoring needs the
VectorChord-enabled Postgres image (the one pinned in `docker-compose.yml`).

## WeatherOrb account database — pulled from the VPS

The WeatherOrb account DB (users, passkeys, sessions, favourites, settings) lives on the
VPS (weatherorb ADR 0013). Its dumps are pulled home so the data exists off the VPS:

- **VPS side (not this repo):** an hourly cron at :15 writes verified
  `pg_dump --format=custom` files `weatherorb_accounts-<UTC %Y%m%dT%H%MZ>.dump` to
  `/var/backups/weatherorb-accounts/` (newest 48 kept), readable only by the
  unprivileged user `wo-backup`.
- **Pull:** `scripts/weatherorb-accounts-pull.sh` (jkrumm crontab, hourly at :25) runs
  `rsync -a` (no `--delete`) as `wo-backup@vps` over Tailscale SSH (MagicDNS host `vps`;
  a tailnet grant for exactly that user) into `/mnt/hdd/backups/weatherorb-accounts/`.
  It then proves the newest local dump is <2 h old and passes `pg_restore --list`
  (one-shot `postgres:18` container), deletes local dumps older than 14 days, and pings
  `WeatherOrb Accounts Backup - Push`: `status=up` on success. A failed rsync still runs the freshness and
  `pg_restore --list` checks on the dumps already held: if they are fresh and valid the run exits nonzero with
  no ping, so the monitor's `maxretries: 1` keeps one missed run PENDING and only two
  consecutive misses page; a missing, stale or corrupt dump pings `status=down` and pages
  at once, whatever the cause of the failed pull. A persistent pull fault (revoked key,
  full disk) therefore pages within ~2 h, never silently.
- **Offsite:** `/mnt/hdd/backups` is a restic source (table above) and
  `restic-excludes.txt` has no rule for this subdirectory, so the dumps ship to B2 with
  the nightly 03:30 run.
- **Push URL:** `~/.config/uptime-kuma/weatherorb-accounts-push-url` (chmod 600) on the
  homelab server — the plain-file convention, never `.env.tpl`. Without the file the
  script logs a warning and skips the ping.
- **Restore drill:** `scripts/weatherorb-accounts-restore-check.sh [dump]` restores the
  newest local dump into a throwaway `postgres:18` container (random password generated
  at runtime, container always removed) and prints row counts for `"user"`, `passkey`,
  `session`, `favourite`, `user_settings` plus the newest `"user".created_at`. Run it by
  hand, or weekly from cron.

```
# crontab -e (jkrumm) — the repo documents these, setup.sh installs only the root watchdog
25 * * * * /home/jkrumm/homelab/scripts/weatherorb-accounts-pull.sh >> /home/jkrumm/logs/weatherorb-accounts-pull.log 2>&1
```

## WeatherOrb archive — pushed from the mini

The weatherorb Mac mini stages an append-only archive of what the weather pipeline
cannot regenerate — the past-track forecast runs (`past/<date>/<round>/…`), database
dumps (`dumps/<date>/…`), round products (`rounds/<round_id>/…`), static grids
(`static/…`) and the published scoreboard days (`scoreboard/…`) — and pushes it to the
`weatherorb-archive` bucket (VersityGW, `docs/s3.md`), which is the directory
`/mnt/hdd/weatherorb-archive`. The mini deletes its own copy only after the bucket is
proven to hold the file's sha256 (weatherorb ADR 0009). The earlier hourly ssh pull
(`weatherorb-archive-pull.sh`, its key and its Kuma push monitor) was retired on
2026-10-23 (weatherorb Wave 91).

- **Write-once:** `scripts/weatherorb-archive-seal.sh` (root timer every 10 min) backfills
  `user.etag` and seals (`chattr +i`) every file untouched for 10 min, so no key can be
  overwritten or deleted, whatever the writer (`docs/s3.md` Caveats).
- **Manifest:** every UTC day the mini pushes a full write-once snapshot of its ledgers,
  `manifest/<date>/INDEX` (`<sha256>  <size>  <relpath>`) and `manifest/<date>/LOST`
  (`<UTC ISO>  <sha256>  <relpath>  <reason>`: a staged file whose bytes exist nowhere).
  The newest snapshot is the whole truth; nothing merges days.
- **Where:** `/mnt/hdd/weatherorb-archive` (`WO_ARCHIVE_DEST`) — deliberately outside
  `/mnt/hdd/backups`, so it is **not** restic-backed and has no offsite copy (owner
  2026-10-22: this HDD is the one copy, ADR 0009).
- **Monitoring:** the mini's watchdog (`archive_backlog`) fails when a staged file or a
  manifest snapshot is not confirmed on the bucket in time; nothing on this side pings.
- **Restore drill:** `scripts/weatherorb-archive-restore-check.sh [<YYYY-MM-DD>]`
  (default: the newest date that has a dump) reads the newest `manifest/*/INDEX`,
  re-hashes every file of that day (`past/<date>/**`, `dumps/<date>/**`) against it,
  skipping and naming each file listed in that snapshot's `LOST`, prints file count and
  bytes per past-track round, then restores the day's dump into a throwaway `postgis/postgis:18-3.6`
  container (random password, no published port, data on a named Docker volume because the
  ~10 GB database does not fit this host's RAM; container and volume removed on exit, and
  a run killed past that is swept by the next one under a lock) and
  prints the dump's table-data entries, per-table row counts (`forecast_point` and
  `observation` flagged) and the newest value of each table's first `timestamptz` column.
  With `WO_RESTORE_SITES=<id>,<id>` it also prints, as CSV, the restored `weatherorb_blend`
  `forecast_point` rows of those stations for the day at leads under 3 h; the weatherorb repo
  compares them against the mini's live rows and the past-track files. Exit nonzero on any
  mismatch or restore failure; the output is the evidence. Run by hand, or weekly from
  cron.

## Two-key pattern (ransomware safety)

| Key | Permissions | Storage | Used by |
| - | - | - | - |
| `common/backblaze-s3` | `listAllBucketNames, listBuckets, readBuckets, listFiles, readFiles, writeFiles` — bucket `jkrumm` (no prefix scope) | 1Password + injected via `op run` | Daily restic backup (homelab) AND daily Postgres dump (VPS). Append-only — no delete perms |
| `Private/Backblaze B2` (`MASTER_KEY_ID` + `MASTER_APP_KEY` fields) | Master (full access) | 1Password ONLY, never automated | `make restic-prune` and `restic-init` from your Mac |

**Why two keys:** the shared automation key can never delete from B2. Even with the restic password leaked, an attacker cannot wipe the offsite repo. Pruning is a deliberate human action with the master key. Single shared automation key (no per-host prefix scoping) — append-only already protects integrity, prefix scoping would only marginally limit a junk-upload cost attack.

## Operations

| Command | What it does | Where |
| - | - | - |
| `make restic-init` | One-time repo init (only runs once) | Mac (admin key) |
| `make restic-deploy` | Deploy/refresh container | Mac → SSH |
| `make restic-run` | Trigger unscheduled backup now | Mac → SSH |
| `make restic-snapshots` | List snapshots | Mac → SSH (container key) |
| `make restic-stats` | Repo size + dedup ratio | Mac → SSH (container key) |
| `make restic-check` | Verify metadata integrity | Mac → SSH (container key) |
| `make restic-prune` | ⚠ Quarterly: reclaim space from forgotten snapshots | Mac (admin key) |
| `make restic-logs` | Tail container logs | Mac → SSH |

**Restore drill (run from Mac — proves offsite recoverability):**

The append-only key (`op://common/backblaze-s3`) has read perms (`listFiles, readFiles`), so restores work from any machine with restic + the repo password. This is the real DR drill — recovering from the laptop without touching homelab.

```bash
# Build env (one-shot; do not export to shell history)
export RR="s3:https://s3.eu-central-003.backblazeb2.com/jkrumm/backups/homelab/restic"

# List snapshots from Mac
RESTIC_REPOSITORY="$RR" \
  RESTIC_PASSWORD="$(op read 'op://homelab/restic/PASSWORD' --account tkrumm)" \
  AWS_ACCESS_KEY_ID="$(op read 'op://common/backblaze-s3/ACCESS_KEY_ID' --account tkrumm)" \
  AWS_SECRET_ACCESS_KEY="$(op read 'op://common/backblaze-s3/SECRET_ACCESS_KEY' --account tkrumm)" \
  restic snapshots --compact

# Restore specific files from a snapshot (use --include for a subset, or omit to restore the whole snapshot)
RESTIC_REPOSITORY="$RR" \
  RESTIC_PASSWORD="$(op read 'op://homelab/restic/PASSWORD' --account tkrumm)" \
  AWS_ACCESS_KEY_ID="$(op read 'op://common/backblaze-s3/ACCESS_KEY_ID' --account tkrumm)" \
  AWS_SECRET_ACCESS_KEY="$(op read 'op://common/backblaze-s3/SECRET_ACCESS_KEY' --account tkrumm)" \
  restic restore <snapshot-id|latest> \
    --target /tmp/restic-drill \
    --include /sources/Dokumente/<path>

# Verify restored vs source (run on homelab side via SSH for the source)
shasum -a 256 /tmp/restic-drill/sources/Dokumente/<path>
ssh homelab "sha256sum /home/jkrumm/ssd/SSD/Dokumente/<path>"
# Hashes must match exactly.

# Compare two snapshots (point-in-time diff for "previous versions")
restic diff <older-id> <newer-id>
```

**Validated 2026-05-04** with snapshot `49918079` (234 GiB / 82,274 files): three test files (text, JSON, SQLite binary) restored from B2 to Mac and SHA-256 matched the homelab originals exactly. `restic check` reported no errors. Restore of all 3 small files completed in <1 second.

`restic diff <id1> <id2>` and `restic ls <id> <path>` both work the same way — useful for finding when a file was deleted or modified.

## Heartbeat monitoring

- Container `POST_COMMANDS_SUCCESS`/`POST_COMMANDS_FAILURE` push to `${RESTIC_HEARTBEAT_URL}` (UptimeKuma).
- Monitor: `Restic Backup - Push` in `uptime-kuma/monitors.yaml`, `Infrastructure` subgroup, 25h interval, `maxretries: 0`.
