# Homelab - Ubuntu Server Management

## Project Context

- **Type:** Infrastructure as Code (Docker Compose)
- **Server:** Ubuntu Server 24.04, remote (dad's house) — physical access limited
- **Network:** Dual routing — Cloudflare tunnel for public services, Tailscale for private
  services, Caddy as the single reverse-proxy layer for both
- **Repository workflow:** Edit locally, push to GitHub, pull on server via SSH
- **VPS:** Hetzner Cloud ARM64 (Ubuntu 22.04) — runs the separate VPS Docker stack, repo at
  `~/SourceRoot/vps` (own README/CLAUDE.md — this repo only documents the Tailscale/Caddy
  integration points it reaches into)

---

## Skills Available

| Skill                   | Context | Purpose                                                                                      |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `/audit`                | main    | Full health audit + repair — containers, resources, storage, updates, errors                 |
| `/cloudflare`           | main    | Cloudflare DNS records + tunnel ingress config operations. Global skill at `~/.claude/skills/cloudflare/` (sourced from dotfiles), shared with VPS |
| `/docs`                 | main    | Documentation maintenance — one owning doc per fact (README/CLAUDE.md/docs/), never restate  |
| `/upgrade-stack <name>` | fork    | Upgrade assistant for manually-managed containers with dependency + breaking change analysis |
| `/commit`               | main    | Smart git commit with conventional commits (inherited from SourceRoot)                       |

**IMPORTANT:** Run `/docs` before committing changes that affect infrastructure or scripts.
**Note:** The REST API + dashboard moved out of this repo to [`jkrumm/argo`](https://github.com/jkrumm/argo) (deployed to the VPS). API/skill changes are argo's responsibility now — homelab only owns the garmin-collector contract on the data side.

---

## Repository Boundary — homelab vs homelab-private

This repo is **public**. `~/SourceRoot/homelab-private/` is a separate, private repo on the
same physical server.

| Owns | This repo (homelab) | homelab-private |
|-|-|-|
| Public/Tailscale-only services | yes | no |
| VPN-routed containers (torrent stack + media) | no | yes |
| Restic backup orchestration | yes — defines what's backed up | excluded by name (its state is in restic excludes) |
| Tailscale ACL source of truth | no | no — moved to `dotfiles-private` 2026-07-27 |

**Hard rules for agents editing this repo:**

- **Do not describe homelab-private containers as part of this stack.** Service tables,
  architecture overviews, compose files, README — these must not list homelab-private
  containers as if they belonged here. Refer to them collectively as the
  "homelab-private stack" or "homelab-private container state".
- **Allowed cross-references** (integration points the homelab stack legitimately
  reaches into):
  - `.env.tpl` — API tokens for homelab-private services consumed by homelab tools
    (e.g. Glance widgets reaching into the media stack).
  - `restic-excludes.txt` — path-level excludes (`/mnt/hdd/qbittorrent`, etc.) so
    homelab-private state is not backed up by the homelab restic job.
  - `scripts/homelab_watchdog.sh` — invokes homelab-private's `vpn-cycle.sh` as part
    of post-Docker-restart recovery.
- These exceptions exist because the integrations are real; new mentions must fall in
  one of these categories or stay out of this repo.
- Tailscale ACL changes go through `dotfiles` make targets — see below.

### Tailscale ACL

Moved out of both homelab repos on 2026-07-27. The whole-tailnet ACL now lives at
`~/SourceRoot/dotfiles-private/tailscale-acl.jsonc`, driven by
`make tailscale-acl-{diff,pull,push}` **in the `dotfiles` repo** (MacBook-only, biometric
`op`). Full model: `dotfiles/CLAUDE.md` → "Tailnet ACL — as code".

---

## SSH Access

```bash
ssh homelab   # jkrumm@<tailscale-ip-homelab>, via Tailscale (primary) — ~/.ssh/config
ssh vps       # jkrumm@<tailscale-ip-vps>, via Tailscale (primary)

# Direct SSH is blocked on both machines — Tailscale is the only path:
#   homelab-direct — blocked by UFW (SSH restricted to Tailscale CGNAT range)
#   vps-direct     — blocked by Hetzner Cloud Firewall (SSH rule removed)
# Emergency access: Hetzner web console (VPS), physical access (HomeLab)
```

```bash
# Common patterns
ssh homelab "docker compose ps"
ssh homelab "cd ~/homelab && git pull && op run --env-file=.env.tpl -- docker compose up -d"
ssh -t homelab "docker logs -f <service>"   # interactive, needed for a follow that expects a TTY
```

**Samba** (file access via Tailscale): direct — Finder → `Cmd+K` → `smb://samba.jkrumm.com`;
fallback tunnel — `ssh -L 1445:localhost:445 homelab` → `smb://localhost:1445`.

---

## Secrets Management (1Password)

**Vaults:** `common` (cross-server), `homelab` (server-specific)
**Pattern:** `op run --env-file=.env.tpl -- <command>`
**Template:** `.env.tpl` committed to git — contains only `op://` references, never actual values

### Key Secrets

| 1Password Path                    | Purpose                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `common/cloudflare/DNS_API_TOKEN` | Caddy DNS-01 ACME challenge                             |
| `homelab/cloudflare-tunnel/TOKEN` | Cloudflare tunnel authentication                        |
| `homelab/postgres/PASSWORD`       | Immich PostgreSQL                                       |
| `homelab/samba/PASSWORD`          | Samba file share auth                                   |
| `homelab/restic/PASSWORD`         | Restic repo password (NEVER changes after init)         |
| `homelab/restic/HEARTBEAT_URL`    | UptimeKuma push URL for restic backup heartbeat         |
| `common/backblaze-s3/*`           | B2 append-only key — shared by homelab restic + VPS pg-dump (no delete perms) |
| `Private/Backblaze B2/MASTER_*`   | B2 master key — manual use only, `make restic-prune`/`init` from Mac |
| `homelab/dufs/PASSWORD`           | Public file server auth                                 |
| `homelab/immich/API_KEY`          | Immich API for Glance widget                            |
| `homelab/garmin/EMAIL`, `homelab/garmin/PASSWORD` | Garmin Connect login                    |
| `common/garmin-collector/PUSH_URL`| UptimeKuma push URL — argo's garmin-sync cron pushes after each successful collector pull (in `common/` so VPS service account can read) |
| `homelab/image-share/API_SECRET`  | Bearer secret for image-share's admin `/api/*` surface (also the SPA login token) |
| `homelab/image-share/KUMA_PUSH_URL` | UptimeKuma push URL — reverse-backup cron (+ manual trigger) heartbeat (monitor id=219) |
| `common/slack/WEBHOOK_ALERTS`     | Slack webhook for alerts (watchdog, UptimeKuma, Beszel) |
| `common/slack/WATCHTOWER_URL`     | Shoutrrr-formatted Slack webhook for Watchtower         |
| `homelab/monitoring/BETTERSTACK_TOKEN`, `homelab/uptime-kuma/PUSH_TOKEN` | Watchdog's own credentials (`op read` at runtime — never a file) |

### Essential Commands

```bash
op run --env-file=.env.tpl -- docker compose up -d
op read "op://homelab/postgres/PASSWORD"
op run --env-file=.env.tpl -- env | grep POSTGRES
```

### Security Rules

- **NEVER** commit secrets or `.env` files with actual values
- **NEVER** log or echo secret values
- All secrets injected at runtime via `op run --env-file=.env.tpl`
- Server auth: `OP_SERVICE_ACCOUNT_TOKEN` is the only secret on disk

---

## Docker Operations

### Makefile Commands (Preferred)

**Always use `make` targets instead of raw docker compose commands.** The Makefile wraps every command with `op run --env-file=.env.tpl --` and executes via SSH, so secrets are always injected correctly and you can't accidentally forget the `op` prefix. Run `make help` for the full, live list.

| Command                   | Purpose                                                  |
| ------------------------- | -------------------------------------------------------- |
| `make deploy`             | Full stack deploy: git pull + recreate all services             |
| `make up` / `make down`   | Start/recreate — stop all services                       |
| `make restart svc=<name>` | Force-recreate a single service                          |
| `make ps` / `make logs svc=<name>` | Show running containers — follow logs           |
| `make immich-upgrade`     | Upgrade Immich stack (git pull + pull pinned images + recreate) — tags are explicit, so bump `immich-server` + `immich-machine-learning` in `docker-compose.yml` first, else it's a no-op. Watchtower-excluded, see `/upgrade-stack immich` |
| `make garmin-deploy` / `-rebuild` / `-restart` | Full deploy — rebuild only (no pull) — restart (env vars only) |
| `make garmin-relogin`     | Interactive MFA re-login — writes fresh tokens, restarts |
| `make garmin-relogin-auto`| Force the automated MFA re-login (see `docs/decisions.md`) |
| `make garmin-logs`        | Follow garmin-collector logs                              |
| `make image-share-deploy` / `-restart` / `-logs` | Same shape as garmin, for image-share |
| `make docker-df` / `docker-prune` | Disk usage — bounded cleanup (see `docs/decisions.md`) |
| `make caddy-reload`       | Force-recreate Caddy (after Caddyfile changes)           |
| `make uk-sync` / `uk-dry-run` / `uk-export` | Apply / preview / export Uptime Kuma monitors (see below) |
| `make test`               | `uv run tests/test_uptime_kuma_sync_guard.py` — local, no network, no server |

### How Secrets Work

1. `.env.tpl` contains `op://` references (committed to git — no actual secrets)
2. `OP_SERVICE_ACCOUNT_TOKEN` is set in the server's `~/.bashrc` (the only secret on disk)
3. `op run --env-file=.env.tpl --` resolves all references at runtime and passes them as env vars
4. Docker Compose `environment:` maps these into container env vars

**Locally-built services, build-cache pruning, agentic push-monitor wiring, and the Garmin
MFA automation are documented in `docs/decisions.md`** — durable rationale, kept out of
this file to stay dense.

### Raw Commands (When Needed)

```bash
ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- docker compose <command>"
ssh homelab "docker compose ps"          # read-only, no op prefix needed
ssh homelab "docker compose logs -f <service>"
```

### Service Dependencies (Start Order)

```
1. docker-socket-proxy (monitoring services depend on this)
2. immich_redis, immich_postgres (databases)
3. caddy (reverse proxy - cloudflared depends on this)
4. All other services
5. cloudflared (depends on caddy + public services - starts last)
```

### Container Updates (Watchtower)

- **Opted-out** (manual via `/upgrade-stack`): `immich-server`, `immich-machine-learning`, `immich_redis`, `immich_postgres`
- **Opted-out** (other): `garmin-collector`, `image-share` (local builds), `karakeep-chrome` + `karakeep-meili` (upstream-pinned tags), `docker-socket-proxy-watchtower`, `dozzle-watchdog-logs` (sidecar), `watchtower` itself
- **Auto-update** (global, daily 4AM): everything else, including `caddy`

---

## Services Reference

**Full service table (public/private/internal, URLs, ports): README → Service Access
Cheatsheet.** This file only carries the operating facts an agent needs beyond that table.

### Network Topology

```
Public:  Internet → Cloudflare CDN (orange cloud) → CF Tunnel → cloudflared → http://caddy:80 → container
Private: Tailscale device → HomeLab TS IP (<tailscale-ip-homelab>) → https://caddy:443 → container
```

**Caddy is the single routing layer** — the `Caddyfile` is the source of truth for all
service routing. Each site block has both an `https://` (Tailscale) and an `http://`
(cloudflared) variant — Caddy defaults new site blocks to HTTPS-only, so the `http://`
variant needs adding explicitly. The global `auto_https disable_redirects` setting keeps
HTTPS cert provisioning working while dropping the HTTP→HTTPS redirect that would
otherwise 301 cloudflared's plain-HTTP connection. TLS comes from Let's Encrypt via the
Cloudflare DNS-01 challenge (`caddy-dns/cloudflare`, baked into the prebuilt
`caddybuilds/caddy-cloudflare` image — there is no `caddy/Dockerfile` in this repo).
Private-service DNS is a grey-cloud (DNS-only) Cloudflare A record pointing at the
HomeLab Tailscale IP. Full rationale: `docs/decisions.md`.

8 Docker bridge networks (`docker-compose.yml` → `networks:`): `cloudflared`, `immich`,
`beszel`, `socket-proxy`, `socket-proxy-watchtower`, `socket-proxy-claude`,
`watchtower-egress`, `karakeep-internal`.

**Tailnet:** `dinosaur-sole.ts.net`. Device IPs are placeholders in every tracked file —
resolve the real ones via `tailscale status` or the admin console, never hardcode them here.

### Docker Socket Security

Monitoring services (Glance, Dozzle, Beszel-Agent, UptimeKuma) access Docker via
`docker-socket-proxy` (`tcp://docker-socket-proxy:2375`) instead of a direct socket mount —
read-only (CONTAINERS, IMAGES, INFO, NETWORKS, VOLUMES; POST/BUILD/EXEC blocked), on an
internal network with no external access. **Exceptions:** Watchtower gets a dedicated
`docker-socket-proxy-watchtower` (POST=1, DELETE=1) on its own isolated network; argo on
the VPS reads container state through `docker-socket-proxy-claude`, bound to the HomeLab
Tailscale IP on `:2376` (read-only, same restrictions).

---

## Storage Layout

### Mount Points

| Path               | Type                     | Purpose                                    |
| ------------------ | ------------------------ | ------------------------------------------ |
| `/home/jkrumm/ssd` | Internal SSD             | Fast storage, databases                    |
| `/mnt/hdd`         | External HDD (encrypted) | Media, backups, large files, restic cache  |
| `/mnt/transfer`    | Partition                | Movies (`Filme/`)                          |

### Key Directories

```
/home/jkrumm/
├── homelab/              # This repository
├── ssd/
│   ├── SSD/
│   │   ├── Bilder/       # Photos (incl. Immich subfolder)
│   │   │   ├── ImageShare/ # image-share ingest area (SHARE_ROOT, rw — the only
│   │   │   │               # writable image root; Fuji/ and RAWs/ are :ro)
│   │   │   └── B2-Mirror/  # image-share reverse-backup of B2 img/ (B2_MIRROR_DIR)
│   │   ├── Bücher/       # Calibre library
│   │   ├── Dokumente/    # Documents — includes Obsidian/ vault sync target
│   │   ├── Videos/       # Personal videos
│   │   ├── Public/       # Dufs public files
│   │   └── Dev/
│   │       └── image-share/  # nightly sqlite VACUUM INTO snapshots (SNAPSHOT_DIR, restic-covered)
│   ├── garmin-tokens/    # Garmin Connect OAuth tokens
│   ├── uptime-kuma/      # UptimeKuma data
│   └── image-share/      # sqlite DB + renditions cache (DATA_DIR, rebuildable — not backed up)

/mnt/hdd/
├── fuji/
│   ├── RAWs/             # Fuji RAW archive (image-share RAWS_ROOT, read-only)
│   └── Videos/           # Fuji video archive (not restic-covered, not indexed)
├── restic/cache/         # Restic local cache (~200 MB metadata)
├── beszel/               # Metrics data
├── filebrowser/          # FileBrowser config
└── backups/              # FPP MySQL hourly dump (restic source)
```

---

## Backups

Restic → Backblaze B2, daily 03:30, two-key ransomware-safe pattern, Mac-side restore
drill. Full design + operations + restore commands: **`docs/backups.md`**.

---

## Repository Structure

Pure infrastructure repo (Docker Compose + ops). The application stack (api + dashboard) lives in [`jkrumm/argo`](https://github.com/jkrumm/argo) on the VPS, deployed via RollHook.

```
homelab/
├── docker-compose.yml       # Service orchestration (25 services, infra + collectors)
├── Caddyfile                # Reverse proxy routing (public + private + garmin/argo collectors)
├── .env.tpl                 # 1Password secret references (op:// URIs)
├── setup.sh                 # Initial server setup (idempotent)
├── packages/
│   └── garmin-collector/    # Python FastAPI — stateless HTTP query layer over Garmin Connect.
│       ├── server.py        #   Owns OAuth tokens. Argo API on VPS pulls /daily-metrics
│       ├── relogin.py       #   + /activities via https://garmin.jkrumm.com (Tailscale-only).
│       ├── relogin_auto.py  #   Bearer-authed via op://common/garmin-collector/TOKEN.
│       └── Dockerfile       #   relogin.py = interactive MFA; relogin_auto.py = MFA fetched
│                             #   from Gmail via argo (driven by scripts/garmin-auto-relogin.sh).
├── scripts/                 # Operational scripts
│   └── homelab_watchdog.sh  # Self-healing health monitor (root crontab, every 10 min)
├── config/                  # App configs + extends
│   ├── glance.yml           # Glance dashboard config
│   └── hwaccel.{ml,transcoding}.yml  # Immich GPU acceleration stubs (not active)
├── docs/                    # Detailed documentation
│   ├── backups.md           # Restic design + restore drill
│   ├── decisions.md         # Durable rationale (build-cache, push monitors, Garmin MFA, Tailscale/Caddy)
│   └── watchdog-behaviors.md
└── uptime-kuma/             # Monitor config-as-code
    ├── sync.py
    └── monitors.yaml
```

**Caddy uses the prebuilt `caddybuilds/caddy-cloudflare` image** — there is no `caddy/`
directory in this repo. `dozzle/` is a root-owned bind mount (`.gitignore`d, holds
`users.yml` + runtime state) that exists only on the server, never checked in.

### Argo (api + dashboard) — separate repo

`jkrumm/argo` lives on the VPS at `https://argo.jkrumm.com` (Tailscale-only, DNS-only A record → VPS Tailscale IP). RollHook manages zero-downtime deploys on push to master. The argo API queries homelab over Tailscale:

- `https://garmin.jkrumm.com` → garmin-collector (this repo)
- `http://${HOMELAB_TAILSCALE_IP}:2376` → docker-socket-proxy-claude (this repo)
- `https://uptime.jkrumm.com` → uptime-kuma (this repo, via socket.io)

See `~/SourceRoot/argo/` and the VPS-side `apps/argo/compose.yml`.

---

## Uptime Kuma Config-as-Code

Monitors are defined in `uptime-kuma/monitors.yaml` and synced via Python script.
**`sync.py` must run ON THE HOMELAB SERVER** — it connects to `localhost:3010`. Never run
locally or on VPS.

```bash
# Preview / apply (public + private merged) / export
ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --dry-run"
ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --extra-config ../homelab-private/uptime-kuma/monitors.yaml"
ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --export"
```

- **`settings.notifications` is the provider set as code.** sync.py attaches every
  live provider to every leaf and none to any group, so it aborts (exit 3) before
  touching a monitor when the live names differ from the declared list — a
  provider added in the UI would double every alert, one deleted would mute them.
  Providers themselves stay UI-managed (webhook in 1Password).
- **Orphan deletion needs a TTY**, and `make uk-sync` (`ssh` without `-t`) has none —
  it only lists them. To actually delete, run `sync.py --delete-orphans` by hand on
  homelab after a dry-run shows *only* the monitors you mean to drop.
- **`--export` flattens to top-level groups only** — a monitor nested in a subgroup
  never appears in the `.exported` file; read it with `api.get_monitor(<id>)`.
- **Every push monitor has `maxretries: 0`** except `Home Line - Watchdog` (2,
  deliberate) — a retry turns a 10-minute time-to-DOWN into 40. Wiring a brand-new
  push monitor end to end is fully agentic; see `docs/decisions.md`.

---

## Watchdog & Self-Healing

`scripts/homelab_watchdog.sh` runs every 10 minutes from **root's crontab** (not
`jkrumm`'s, not `/etc/cron.d`, not a systemd timer):

```
*/10 * * * * . /root/.profile; /home/jkrumm/homelab/scripts/homelab_watchdog.sh
```

Root, because the script restarts containers, remounts the HDD and can reboot. Verify
it's firing without sudo: `ssh homelab "journalctl -u cron --since '30 min ago' --no-pager | grep homelab_watchdog"`.

Full failure scenarios, escalation states (0-4), config values and log files:
**`docs/watchdog-behaviors.md`**. One fact worth surfacing here: the watchdog
**auto-clears** `manual_intervention_required` once health checks pass again — a long
outage does not need manual SSH to resume, only genuinely unrecoverable states
(HDD disconnected, LUKS locked, 3 reboots/day) stay stuck until a human intervenes.

```bash
# Manual clear (rarely needed — auto-clears when healthy)
ssh homelab "sudo rm /var/lib/homelab_watchdog/manual_intervention_required"
```

---

## Change Management Workflow

```bash
# 1. Edit locally, commit via /commit (only when requested), push to GitHub
# 2. Deploy
make deploy          # Full stack (git pull + recreate all)
make garmin-deploy   # garmin-collector only (git pull + rebuild + restart)
make caddy-reload    # Caddy only (after Caddyfile changes)
# 3. Verify
make ps
curl -I https://glance.jkrumm.com
```

---

## Troubleshooting

| Issue                  | Diagnosis         | Solution                              |
| ---------------------- | ----------------- | ------------------------------------- |
| Service not accessible | Check cloudflared | `docker logs cloudflared`             |
| Container crash loop   | Check logs        | `docker logs --tail=100 <container>`  |
| HDD not mounted        | Check encryption  | `sudo cryptsetup status encrypted_partition && mount \| grep hdd` |
| Immich ML slow         | Check GPU         | Not active on this server (CPU-mode only) — `docker logs immich_machine_learning` |

```bash
ssh homelab "df -h && free -h && uptime"          # system resources
ssh homelab "docker system df"                    # docker disk usage
ssh homelab "docker inspect --format='{{.State.Health.Status}}' <container>"
ssh homelab "docker stats --no-stream"
ssh homelab "mount | grep hdd && ls /mnt/hdd"
ssh homelab "dmesg | tail -50"
```

---

## Resource Limits & Logging

### Memory Limits

| Service       | Limit | Reserved |
| ------------- | ----- | -------- |
| Immich Server | 4G    | -        |
| Immich ML     | 4G    | -        |
| UptimeKuma    | 1G    | 512M     |

### Log Rotation

| Service             | Max Size | Max Files |
| ------------------- | -------- | --------- |
| docker-socket-proxy | 10m      | 2         |
| Immich Server       | 50m      | 5         |

---

## Agent Behavioral Guidelines

### Always Do

- **Confirm irreversible/outward-facing operations:** Ask before reboots, volume/data deletion, or Cloudflare tunnel changes
- **Test incrementally:** Apply changes one service at a time when possible
- **Verify after changes:** Check service health after any modification
- **Reference README.md:** For setup procedures and the service table, not this file

### Never Do

- **Bypass the Makefile for server operations** — every target already wraps `op run` and SSH correctly; raw `docker compose` on the server risks a missing secret. (Local, read-only tooling — `make test`, `make help` — is meant to run locally.)
- **Force reboot remotely:** Physical access is limited - reboots are risky
- **Modify watchdog credentials** without checking `docs/watchdog-behaviors.md` first
- **Delete data without confirmation:** Especially on `/mnt/hdd`

### Documentation Workflow

When making changes that affect infrastructure or script behavior: make the code change →
run `/docs` to keep README/CLAUDE.md/docs/ each owning their own facts → review with
`git diff` → commit with `/commit` when satisfied.

### Confirmation Required For

- System reboots or shutdowns
- Removing containers with volumes (`docker compose down -v`)
- Modifying encrypted HDD mount configuration
- Changing Cloudflare tunnel settings
