# Backups (Restic → Backblaze B2)

**Repo:** `s3:https://s3.eu-central-003.backblazeb2.com/jkrumm/backups/homelab/restic`
**Schedules:** backup daily 03:30 (container cron, `BACKUP_CRON`); integrity check weekly; read-back check and restore drill twice a month — the three verification jobs are under "Verification" below
**Retention (forget, automated):** `keep-daily 14, keep-weekly 8, keep-monthly 12, keep-yearly 5`
**Container:** `mazzolino/restic`, pinned by digest (restic 0.19.1, built 2026-07-07) — see `restic-backup` service in `docker-compose.yml`. Watchtower skips it (`watchtower.enable: false`); bump the digest by hand after a check and a drill pass on the new image.
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
| `/home/jkrumm/ssd/SSD/Dokumente` | `/sources/Dokumente` | Documents, tax, studies; `Obsidian/` is an empty folder, not a sync target |
| `/home/jkrumm/ssd/SSD/Bücher` | `/sources/Buecher` | |
| `/home/jkrumm/ssd/SSD/Videos` | `/sources/Videos` | |
| `/home/jkrumm/ssd/SSD/Public` | `/sources/Public` | Ex-dufs public files (service retired 2026-10-19, data kept) |
| `/home/jkrumm/ssd/SSD/Dev` | `/sources/Dev` | Static files (no node_modules) |
| `/mnt/hdd/fuji/RAWs` | `/sources/Fuji-RAWs` | 169 GiB, 6,320-file Fuji RAW archive (1,549 RAWs / 43 GiB left it on 2026-11-14 on purpose: culled in Shutterflow, removed by an owner session) |
| `/mnt/hdd/backups` | `/sources/hermes-backup` | Daily Hermes Agent backup (Mac Mini → SSH-pushed) + `weatherorb-accounts/` hourly VPS DB dumps (see "WeatherOrb account database" below) |
| `/mnt/hdd/karakeep/data` | `/sources/Karakeep` | Karakeep SQLite DB + crawled assets (Meili index excluded — rebuildable). Live-DB caveat: see "Karakeep SQLite" below |
| `/home/jkrumm/ssd/proton-bridge` | `/sources/ProtonBridge` | Proton Bridge vault + gpg keyring + pass store (gluon message cache excluded — re-synced; see `docs/proton-bridge.md`) |
| `/home/jkrumm/backups` | `/sources/home-backups` | Age-encrypted 1Password vault exports (`1password/`, rsynced from the MacBook by the opbackup job, dotfiles `scripts/backup-1password.py`) — the recovery root for every other secret — plus `immich-pre-upgrade/` dumps. Before this mount they existed only on the HomeLab's internal SSD |
| `/home/jkrumm/ssd/versitygw/iam` | `/sources/VersityGW-IAM` | VersityGW IAM dir: S3 users + policies (`docs/s3.md`). Object data is not here — it lives in the backed-up trees or is deliberately not backed up |

**Excludes worth knowing:** `*.tmp` also drops `Bilder/HANDY 2/Camera/VID_20200726_133912.mp4.tmp` (1.27 GiB). It is not a video: `ffprobe` reports `moov atom not found` (a recording cut short, the `mdat` atom runs into junk), so it stays unrenamed and unbacked on purpose; the pattern is not loosened.

**Skipped intentionally:** Immich raw Postgres data dir (`Bilder/immich/postgres` — excluded; a filesystem copy of a live PGDATA is not restorable, see "Immich database" below), UptimeKuma data (IaC), Caddy/Beszel/Dozzle/FileBrowser state, all homelab-private container state, `/mnt/hdd/Filme`, `/mnt/transfer/*` (empty since 2026-11-14), `/mnt/hdd/fuji/Videos`, `/mnt/hdd/Videos` (big personal videos, local mirror on the mini only), argo SQLite (lives on VPS — backed up alongside VPS Postgres dump cron).

## Karakeep SQLite — accepted risk

Restic copies the live Karakeep SQLite database file-level, no dump. Karakeep is expected to run the
DB in WAL mode (not verified on the box), so a consistent state is the DB file plus its `-wal` file; both sit in
the same backed-up directory, and the `*-shm`/`*-journal` excludes only drop the
rebuildable shared-memory index and rollback journals. **Restore = copy back the whole
set** (`db.db`, `db.db-wal`), never the main file alone. Residual risk: a copy taken
mid-checkpoint can be inconsistent; SQLite then reports corruption on open and the
previous day's snapshot is the fallback. Accepted, no pre-backup dump (not built).

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
  2026-10-22: this HDD is the one copy, ADR 0009). That USB HDD had re-enumeration
  events on 2026-10-21 and 2026-10-27; ADR 0009 accepted that risk, flagged for the
  owner to revisit.
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
| `make restic-check` | Weekly structure check now, pings its Kuma monitor | Mac → SSH (container key) |
| `make restic-check-subset` | This half-month's `--read-data-subset=N/24` read-back, pings its monitor | Mac → SSH (container key) |
| `make restic-drill` | Restore drill from B2, pings its monitor | Mac → SSH (container key) |
| `make restic-unlock` | ⚠ Remove stale repo locks (run before a prune, and whenever the checks report them) | Mac (admin key) |
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

**Automated since 2026-11-15** by `scripts/restic-restore-check.sh` (see "Verification"); the manual drill below stays the laptop-side proof. **Validated by hand 2026-05-04** with snapshot `49918079` (234 GiB / 82,274 files): three test files (text, JSON, SQLite binary) restored from B2 to Mac and SHA-256 matched the homelab originals exactly. `restic check` reported no errors. Restore of all 3 small files completed in <1 second.

`restic diff <id1> <id2>` and `restic ls <id> <path>` both work the same way — useful for finding when a file was deleted or modified.

## Verification — the repository proves it can be read back

The image runs one cron job per container, so the three verification jobs are in the
`jkrumm` crontab on the HomeLab and reach restic through `docker exec restic-backup`
(the container's append-only key reads B2). Each pushes to its own Kuma monitor
(`Infrastructure` subgroup, push URL in `~/.config/uptime-kuma/<name>-push-url`, chmod 600):

| Job | Schedule (server time) | What it does | Monitor |
| - | - | - | - |
| `scripts/restic-check.sh weekly` | Sunday 10:00 | `restic check --no-lock`: index, snapshots and trees; ~40 s | `Restic Check Weekly - Push`, 8 d |
| `scripts/restic-check.sh subset` | 1st and 15th, 10:00 | the same plus `--read-data-subset=N/24` — N walks 1..24 over a year, so every pack is downloaded and hashed once a year (~16 GiB per run) | `Restic Read Check - Push`, 20 d |
| `scripts/restic-restore-check.sh` | 1st and 15th, 12:00 | restore drill, below | `Restic Restore Drill - Push`, 20 d |

```
# crontab -e (jkrumm) — the repo documents these, setup.sh installs only the root watchdog
0 10 * * 0    /home/jkrumm/homelab/scripts/restic-check.sh weekly >> /home/jkrumm/logs/restic-check.log 2>&1
0 10 1,15 * * /home/jkrumm/homelab/scripts/restic-check.sh subset >> /home/jkrumm/logs/restic-check.log 2>&1
0 12 1,15 * * /home/jkrumm/homelab/scripts/restic-restore-check.sh >> /home/jkrumm/logs/restic-restore-check.log 2>&1
```

Why twice a month and not monthly: Uptime Kuma caps a monitor interval at 24 days, so a
monthly push monitor would sit PENDING for a week every month. Half-monthly runs keep the
interval at 20 days and the slices at 24 a year.

**`--no-lock` is deliberate.** The append-only key cannot delete, so a backup killed
mid-run (a deploy recreating the container, a reboot) leaves its lock file in the repo for
good, and a plain `restic check` wants an exclusive lock that any leftover lock refuses
(`repo already locked by PID 188 … 4h43m ago`, 2026-11-15, two stale locks). `check` only
reads and prune is a manual master-key job, so reading unlocked is safe. Stale locks also
block the nightly `restic forget` ("Forget failed" in the container log while the backup
still exits 0), so retention silently stops until someone runs `make restic-unlock` (Mac,
master key). Both checks therefore fail — `down` push, `FAIL: … stale repo lock` in the log —
when a lock is older than 36 h. 2026-11-15: two stale locks (03:45 and 04:59), both from
killed runs that day, blocked `forget`; the deploy guard (`_restic-idle` in the Makefile)
exists so a deploy no longer kills a running backup.

**Failures are visible** in the job log (`~/logs/restic-check.log`,
`~/logs/restic-restore-check.log`, `FAIL:` lines carry the restic output) and as a `down`
push with the reason in the monitor message; a job that does not run at all stops the
heartbeat, and the monitor goes DOWN after its interval plus one retry.

### Restore drill

`scripts/restic-restore-check.sh` restores a sample of the newest `homelab` snapshot
straight from B2 into a temp directory in the container, compares sha256 with the live
files under `/sources`, removes the directory and pushes the status:

- sample: 3 files per source (files up to 64 MiB, no glob characters in the name), picked
  by a shuffle seeded with the date (`DRILL_SEED=<text>` replays a run);
- plus the newest Immich database dump in the snapshot (`gzip -t` and the
  `PostgreSQL database dump complete` trailer). No dump in the snapshot is a note, not a
  failure, so the job survives the Immich retirement;
- a live file changed after the snapshot or gone from the live tree is skipped and named;
  any other difference, a missing restored file or fewer than 10 compared files exits
  non-zero and pushes `down`;
- `DRILL_TAMPER=1` flips a restored byte first: the proof that a mismatch is caught.

### Prune — how to read when it is due

Prune is manual with the master key (`make restic-prune`, from the Mac). Compare what the
repository holds with what the newest snapshot alone needs:

```bash
make restic-stats                                              # repo raw-data (everything B2 holds)
ssh homelab docker exec restic-backup restic stats --mode raw-data latest   # the newest snapshot's share
```

2026-11-15: repo 460.9 GiB raw-data against 365.0 GiB for the newest snapshot, a ratio of 1.26, and `restic check` reports "307 additional files … likely contain duplicate data". The rule: **prune when the repo is more than ~1.25× the newest snapshot**, i.e. a quarter of B2 is forgotten data. It is due now. The date of the last prune is not recorded anywhere; the owner records it here after the next run (`Last prune: <date>`).

## Heartbeat monitoring

- Container `POST_COMMANDS_SUCCESS`/`POST_COMMANDS_FAILURE` push to `${RESTIC_HEARTBEAT_URL}` (UptimeKuma).
- Monitor: `Restic Backup - Push` in `uptime-kuma/monitors.yaml`, `Infrastructure` subgroup, 25h interval, `retry_interval: 3600`, `maxretries: 1`.
