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
| `/home/jkrumm/ssd/SSD/Public` | `/sources/Public` | Dufs files |
| `/home/jkrumm/ssd/SSD/Dev` | `/sources/Dev` | Static files (no node_modules) |
| `/mnt/hdd/fuji/RAWs` | `/sources/Fuji-RAWs` | ~118 GB Fuji RAW archive |
| `/mnt/hdd/backups` | `/sources/hermes-backup` | Daily Hermes Agent backup (Mac Mini → SSH-pushed) |
| `/mnt/hdd/karakeep/data` | `/sources/Karakeep` | Karakeep SQLite DB + crawled assets (Meili index excluded — rebuildable) |

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
