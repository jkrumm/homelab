# Homelab - Ubuntu Server Management

## Project Context

- **Type:** Infrastructure as Code (Docker Compose)
- **Server:** Ubuntu Server 24.04
- **Location:** Remote (dad's house) - physical access limited
- **Network:** Dual routing — Cloudflare tunnel for public services, Tailscale for private services, Caddy as reverse proxy
- **Repository Workflow:** Edit locally, push to GitHub, pull on server via SSH
- **VPS:** Hetzner Cloud ARM64 (Ubuntu 22.04) at `5.75.178.196` - runs sideproject-docker-stack
- **VPS Repo (local):** `/Users/johannes.krumm/SourceRoot/sideproject-docker-stack/`

### Local Tools Available (MacBook)

| Tool | Purpose |
|------|---------|
| Tailscale CLI | `/Applications/Tailscale.app/Contents/MacOS/Tailscale` - mesh VPN management |
| Cloudflare CLI | DNS and tunnel management |
| Zed | SSH remote development (supports `Open Remote` with SSH hosts) |
| Doppler CLI | Secrets management |

---

## Commands Available

| Command | Purpose |
|---------|---------|
| `/audit` | Full health audit + repair — containers, resources, storage, updates, errors |
| `/cloudflare` | Cloudflare DNS records + tunnel ingress config operations |
| `/docs` | Documentation maintenance - audit and update README.md, CLAUDE.md, docs/, cheatsheets, skills |
| `/upgrade-stack <name>` | Smart upgrade for multi-component stacks (SigNoz, Immich, Plausible) |
| `/commit` | Smart git commit with conventional commits (inherited from SourceRoot) |

### `/docs` Command

Run `/docs` to:
- Audit infrastructure changes (new services, scripts, configs)
- Identify outdated documentation
- Update cheatsheet commands in README.md and CLAUDE.md
- Update behavior documentation in `docs/` directory
- Synchronize table of contents
- **Check if new multi-component stacks need to be added to `/upgrade-stack` skill**

**When to use:** After adding/removing services, changing ports, adding scripts, modifying configurations, or changing script behavior.

**IMPORTANT:** Run `/docs` before committing changes that affect infrastructure or scripts.

### `/upgrade-stack` Command

Upgrade multi-component Docker stacks that have WUD set to notify-only or ignore.

**Usage:**
```bash
/upgrade-stack signoz    # Upgrade SigNoz stack
/upgrade-stack immich    # Upgrade Immich stack
/upgrade-stack plausible # Upgrade Plausible stack (when added)
/upgrade-stack --check-all # Check all stacks for updates
```

**What it does:**
- Researches latest stable versions and release notes
- Analyzes breaking changes and migration requirements
- Checks version compatibility between components
- Generates upgrade plan with backup commands
- Provides rollback instructions

**Why these stacks need manual updates:**
- Multi-component with databases (ClickHouse, Postgres)
- Breaking changes between versions (schema migrations, API changes)
- Version compatibility requirements between components

**Supported stacks:**
- **SigNoz**: ClickHouse + Query Service + OTel Collector + Alert Manager
- **Immich**: Server + ML + Postgres + Redis
- **Plausible**: (future) Plausible + ClickHouse + Postgres

---

## SSH Access

### Connection Methods

```bash
# HomeLab - via Tailscale (primary)
ssh homelab
# resolves to: jkrumm@${HOMELAB_TAILSCALE_IP} (via ~/.ssh/config)

# VPS - via Tailscale (primary)
ssh vps
# resolves to: jkrumm@100.82.157.104 (via ~/.ssh/config)

# Direct SSH is blocked on both machines:
# ssh homelab-direct  # BLOCKED — UFW denies SSH from non-Tailscale IPs
# ssh vps-direct      # BLOCKED — Hetzner Cloud Firewall blocks port 22 (use web console)
```

> **SSH config:** `~/.ssh/config` defines all hosts. Shell aliases `homelab` → `ssh homelab`, `vps` → `ssh vps` in `~/.zshrc`.

### Samba (file access via Tailscale)

```bash
# Direct (preferred) — Finder → Cmd+K:
# smb://samba.jkrumm.com

# SSH tunnel (fallback):
ssh -L 1445:localhost:445 homelab
# Then: smb://localhost:1445
```

### Claude Code SSH Patterns

```bash
# Single command execution
ssh homelab "docker compose ps"

# Multi-command execution
ssh homelab "cd ~/homelab && git pull && doppler run -- docker compose up -d"

# Interactive session (when needed for debugging)
ssh -t homelab "docker logs -f [redacted]"
```

---

## Secrets Management (Doppler)

**Project:** `homelab` | **Config:** `prod`

### Key Secrets

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_TOKEN` | Cloudflare tunnel authentication |
| `CLOUDFLARE_API_TOKEN` | DDNS + Caddy DNS-01 ACME challenge |
| `POSTGRES_DB_PASSWORD` | Immich PostgreSQL |
| `SAMBA_PASSWORD` | Samba file share auth |
| `CALIBRE_PASSWORD` | Calibre GUI access |
| `DUPLICATI_*` | Duplicati backup encryption |
| `[redacted]_PRIVATE_KEY` | [redacted] [redacted] |
| `DUFS_PASSWORD` | Public file server auth |
| `IMMICH_API_KEY` | Immich API for Glance widget |
| `COUCHDB_PASSWORD` | CouchDB admin password |
| `NTFY_TOKEN` | ntfy Bearer token (shared across HomeLab watchdog, Watchtower notifications) |

### Essential Doppler Commands

```bash
# Run docker compose with secrets
doppler run -- docker compose up -d

# View specific secret
doppler secrets get CLOUDFLARE_TOKEN

# Run any command with secrets
doppler run -- env | grep POSTGRES
```

### Security Rules

- **NEVER** commit secrets or `.env` files
- **NEVER** log or echo secret values
- All secrets injected at runtime via Doppler

---

## Docker Operations

### Essential Commands

All commands must be run from `~/homelab` directory with Doppler prefix:

```bash
# Start all services
doppler run -- docker compose up -d

# View running containers
docker compose ps

# View logs (follow mode)
docker compose logs -f <service>

# Restart single service
doppler run -- docker compose restart <service>

# Rebuild and restart service (after config change)
doppler run -- docker compose up -d --force-recreate <service>

# Pull latest images and restart
docker compose pull && doppler run -- docker compose up -d

# Full rebuild (after docker-compose.yml changes)
docker compose down && doppler run -- docker compose up -d
```

### Service Dependencies (Start Order)

```
1. docker-socket-proxy (monitoring services depend on this)
2. [redacted] (VPN - [redacted] depends on this)
3. immich_redis, immich_postgres (databases)
4. excalidash-backend (frontend depends on this)
5. caddy (reverse proxy - cloudflared depends on this)
6. All other services
7. cloudflared (depends on caddy + public services - starts last)
```

### Troubleshooting Commands

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' <container>

# View container resource usage
docker stats --no-stream

# Execute command in container
docker exec -it <container> sh

# View recent container events
docker events --since 1h --filter container=<name>
```

---

## Services Reference

### Public Services (Cloudflare Tunnel → Caddy → container)

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| Glance | 8080 | glance.jkrumm.com | Dashboard |
| Immich | 2283 | immich.jkrumm.com | Photo management |
| UptimeKuma | 3010 | uptime.jkrumm.com | Service monitoring |
| ExcaliDash | 8084 | draw.jkrumm.com | Whiteboard |
| Dufs | 8098 | public.jkrumm.com | Public file sharing |
| Plausible | 8088 | plausible.jkrumm.com | Web analytics |
| OTLP Ingestion | 4318 | otlp.jkrumm.com | OpenTelemetry ingestion (browser apps) |
| Zot Registry | 5080 | registry.jkrumm.com | OCI container registry |
| ntfy | 8093 (host) / 80 (container) | ntfy.jkrumm.com | Push notification server |

### Private Services (Tailscale → Caddy HTTPS :443 → container)

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| Beszel | 8090 | beszel.jkrumm.com | System metrics |
| Dozzle | 8081 | dozzle.jkrumm.com | Container logs |
| Duplicati | 8200 | duplicati.jkrumm.com | Backups |
| FileBrowser | 80 | files.jkrumm.com | File management |
| Calibre GUI | 8080 | calibre.jkrumm.com | Book management admin |
| Calibre-Web | 8083 | books.jkrumm.com | E-book library |
| [redacted] | 8096 | [redacted].jkrumm.com | Media streaming |
| SigNoz | 8089 | signoz.jkrumm.com | Application observability (APM) |
| WUD | - | wud.jkrumm.com | Container update tracker (What's Up Docker) |
| CouchDB | 5984 | couchdb.jkrumm.com | CouchDB document database |

> **Access:** DNS A records point to HomeLab Tailscale IP (${HOMELAB_TAILSCALE_IP}, DNS-only/grey cloud). Only reachable from Tailscale devices. Caddy serves HTTPS with Let's Encrypt certs via DNS-01 challenge.

### Internal Services

| Service | Purpose |
|---------|---------|
| Caddy | Reverse proxy for all services (HTTP :80 + HTTPS :443, custom build with cloudflare DNS plugin) |
| docker-socket-proxy | Secure Docker API proxy (read-only TCP) |
| Cloudflared | Tunnel to Cloudflare (public services only) |
| Cloudflare-DDNS | Dynamic DNS updates |
| WUD (What's Up Docker) | Container update notifications + auto-updates for most images (direct socket) |
| Watchtower | Auto-updates for lscr.io containers ([redacted], duplicati, calibre, calibre-web, [redacted]) — opt-in via label |
| [redacted] | VPN gateway ([redacted]) |
| [redacted] | [redacted] client (via VPN) |
| Samba | SMB3 file shares (encryption preferred) |
| Calibre | E-book management GUI |
| Beszel-Agent | System metrics collector |
| Immich ML | Photo AI processing |
| Immich Postgres/Redis | Immich databases |
| ClickHouse | SigNoz primary datastore (traces, metrics, logs) |
| SigNoz | SigNoz backend API + UI + Alert Manager (unified binary) |
| SigNoz OTel Collector | OpenTelemetry ingestion gateway |
| Plausible | Web analytics (shared ClickHouse + Immich Postgres) |
| CouchDB | CouchDB document database |

### Network Topology

```
Public:  Internet → Cloudflare CDN (orange cloud) → CF Tunnel → cloudflared → http://caddy:80 → container
Private: Tailscale device → HomeLab TS IP (${HOMELAB_TAILSCALE_IP}) → https://caddy:443 → container
```

**Key:** Caddy is the single routing layer. The `Caddyfile` is the source of truth for all service routing. Each site block has both HTTPS (Tailscale) and `http://` (cloudflared) variants.

Docker bridge networks: `cloudflared`, `immich`, `beszel`, `excalidash`, `socket-proxy`, `signoz`

### Tailscale

**Tailnet:** `dinosaur-sole.ts.net` | **Migration plan:** `docs/TAILSCALE.md`

| Machine | Tailscale IP | SSH Host |
|---------|-------------|----------|
| HomeLab | ${HOMELAB_TAILSCALE_IP} | `ssh homelab` |
| VPS | 100.82.157.104 | `ssh vps` |
| MacBook | 100.124.248.40 | - |
| iPhone | 100.85.45.3 | - |

**Migration status:** Phase 1-11 done (Tailscale, Caddy, security hardening complete). Phase 8 Zed remote dev pending. See `docs/TAILSCALE.md`.

### Docker Socket Security

Monitoring services (Glance, Dozzle, Beszel-Agent, UptimeKuma) access Docker via `docker-socket-proxy` instead of direct socket mount:

- **Proxy URL:** `tcp://docker-socket-proxy:2375`
- **Read-only:** Only CONTAINERS, IMAGES, INFO, NETWORKS, VOLUMES enabled
- **Write disabled:** POST, BUILD, EXEC, etc. all blocked
- **Internal network:** socket-proxy network has no external access
- **Exception:** Watchtower uses a dedicated `docker-socket-proxy-watchtower` (POST=1, DELETE=1) on an isolated network

---

## Storage Layout

### Mount Points

| Path | Type | Purpose |
|------|------|---------|
| `/home/jkrumm/ssd` | Internal SSD | Fast storage, databases |
| `/mnt/hdd` | External HDD (encrypted) | Media, backups, large files |
| `/mnt/transfer` | Partition | Duplicati backup destination |

### Key Directories

```
/home/jkrumm/
├── homelab/              # This repository
├── ssd/
│   ├── SSD/
│   │   ├── Bilder/       # Immich photos, Fuji imports
│   │   ├── Bücher/       # Calibre library
│   │   ├── Dokumente/    # ExcaliDash, misc
│   │   └── Public/       # Dufs public files
│   ├── couchdb/          # CouchDB data
│   └── uptime-kuma/      # UptimeKuma data

/mnt/hdd/
├── Filme/                # [redacted] media library
│   ├── Movies/
│   ├── Shows/
│   └── Kids/
├── [redacted]/             # [redacted] config/cache
├── [redacted]/         # [redacted] downloads
├── duplicati/            # Backup configs
├── beszel/               # Metrics data
├── filebrowser/          # FileBrowser config
└── backups/              # Database backups
```

### Storage Usage Patterns

- **SSD:** Databases, frequently accessed files, application configs
- **HDD:** Media files, backups, archives, large datasets

---

## Repository Structure

```
homelab/
├── docker-compose.yml       # Service orchestration (all 28 containers)
├── Caddyfile                # Reverse proxy routing (public + private)
├── doppler.yaml             # Secrets project config
├── setup.sh                 # Initial server setup (idempotent)
├── scripts/                 # Operational scripts
│   ├── homelab_watchdog.sh  # Self-healing health monitor (cron)
│   ├── [redacted]_manager.py   # [redacted] CLI
│   ├── check_hdd.sh         # HDD diagnostics
│   ├── fix_uptime_kuma_monitors.sh
│   ├── get_container_ips.sh
│   └── backup_fpp_db.sh
├── config/                  # App configs + extends
│   ├── glance.yml           # Dashboard config
│   ├── hwaccel.ml.yml       # Immich ML GPU acceleration
│   ├── hwaccel.transcoding.yml  # Immich transcoding GPU
│   └── [redacted]-monitor.service  # Systemd unit
├── docs/                    # Detailed documentation
│   ├── TAILSCALE.md         # Migration plan + learnings
│   └── watchdog-behaviors.md # Failure scenarios + recovery
├── caddy/Dockerfile         # Custom Caddy build (cloudflare DNS plugin)
├── dozzle/                  # Dozzle auth + TLS certs
└── uptime-kuma/             # Monitor config-as-code
    ├── sync.py
    └── monitors.yaml
```

---

## Available Scripts

### Quick Reference

| Script | Location | Purpose |
|--------|----------|---------|
| `homelab_watchdog.sh` | `scripts/` | Self-healing health monitor |
| `[redacted]_manager.py` | `scripts/` | [redacted] CLI |
| `check_hdd.sh` | `scripts/` | HDD diagnostics |
| `fix_uptime_kuma_monitors.sh` | `scripts/` | Monitor diagnostics |
| `get_container_ips.sh` | `scripts/` | Container IP lookup |
| `backup_fpp_db.sh` | `scripts/` | FPP database backup |
| `sync.py` | `uptime-kuma/` | Config-as-code monitor sync |
| `setup.sh` | root | Initial server setup |

### Uptime Kuma Config-as-Code

Monitors are defined in `uptime-kuma/monitors.yaml` and synced via Python script.
**IMPORTANT:** sync.py must run ON THE HOMELAB SERVER — it connects to localhost:3010. Never run locally or on VPS.

```bash
# Preview changes (dry run)
ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --dry-run"

# Apply changes
ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py"

# Export current monitors to YAML
ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --export"
```

### [redacted] Manager Usage

```bash
# List [redacted]s
python3 ~/homelab/scripts/[redacted]_manager.py list

# Add [redacted] (magnet or file)
python3 ~/homelab/scripts/[redacted]_manager.py add "magnet:?xt=..."

# Remove [redacted]
python3 ~/homelab/scripts/[redacted]_manager.py remove <id>

# Check VPN status
python3 ~/homelab/scripts/[redacted]_manager.py vpn-status
```

### HDD Diagnostics

```bash
# Run 7-step HDD verification
./scripts/check_hdd.sh
```

---

## Watchdog & Self-Healing

The `scripts/homelab_watchdog.sh` script runs via cron every 10 minutes and provides multi-level self-healing.

**Detailed behavior documentation:** See `docs/watchdog-behaviors.md` for failure scenarios and recovery paths.

### Escalation Levels

| Level | Trigger | Action |
|-------|---------|--------|
| 0 | Healthy | No action |
| 1 | First failure | Wait for recovery, Docker restart |
| 2 | Persistent failure | Network interface restart |
| 3 | Continued failure | Aggressive Docker cleanup |
| 4 | Critical | System reboot (max 3/day) |

### Auto-Recovery After Manual Intervention

The watchdog auto-clears the `manual_intervention_required` flag when the system becomes healthy:
- Even with flag set, health checks still run every 10 minutes
- If all checks pass → flag is auto-cleared → normal operation resumes
- This allows self-healing after long outages (e.g., ISP down for hours)

### Key Files

| File | Purpose |
|------|---------|
| `/var/lib/homelab_watchdog/state` | Current escalation level |
| `/var/lib/homelab_watchdog/manual_intervention_required` | Blocks aggressive recovery (auto-clears when healthy) |
| `/var/lib/homelab_watchdog/reboot_tracker` | Daily reboot count |
| `/var/log/homelab_watchdog.log` | Watchdog logs |
| `/root/.homelab-watchdog-credentials` | Pushover/BetterStack/UptimeKuma tokens |

### Manual Intervention

```bash
# Check if manual intervention required
ls /var/lib/homelab_watchdog/manual_intervention_required

# Clear flag to resume auto-recovery (usually not needed - auto-clears when healthy)
sudo rm /var/lib/homelab_watchdog/manual_intervention_required

# View watchdog state
cat /var/lib/homelab_watchdog/state

# Reset state to healthy
echo 0 | sudo tee /var/lib/homelab_watchdog/state

# View recent watchdog logs
tail -100 /var/log/homelab_watchdog.log
```

### Health Checks Performed

1. Mount integrity (`/mnt/hdd` accessible and writable)
2. Internet connectivity (ping 8.8.8.8, 1.1.1.1, 9.9.9.9)
3. External monitor (BetterStack API)
4. Internal monitor (UptimeKuma status page)
5. Docker health (key containers running)
6. Tailscale health (`tailscale status` + retry → restarts `tailscaled` independently, own state file)

---

## Change Management Workflow

### Pre-Change Checklist

1. [ ] Pull latest changes locally: `git pull`
2. [ ] Review current server state: `ssh homelab "docker compose ps"`
3. [ ] Check Glance dashboard for service health

### Git Workflow

```bash
# 1. Edit locally (this machine)
vim docker-compose.yml

# 2. Commit via /commit command (only when requested)
# This follows the standard workflow

# 3. Push to GitHub
git push

# 4. Pull and apply on server
ssh homelab "cd ~/homelab && git pull && doppler run -- docker compose up -d"
```

### Verification Steps

```bash
# Check services started
ssh homelab "docker compose ps"

# Watch logs for errors
ssh homelab "docker compose logs -f --tail=50"

# Verify external access
curl -I https://glance.jkrumm.com
```

---

## Troubleshooting

### Common Issues

| Issue | Diagnosis | Solution |
|-------|-----------|----------|
| Service not accessible | Check cloudflared | `docker logs cloudflared` |
| Container crash loop | Check logs | `docker logs --tail=100 <container>` |
| HDD not mounted | Check encryption | Run `./scripts/check_hdd.sh` |
| VPN not working | Check [redacted] | `docker logs [redacted]` |
| Immich ML slow | Check GPU | `docker logs immich_machine_learning` |

### Diagnostic Commands

```bash
# System resources
ssh homelab "df -h && free -h && uptime"

# Docker disk usage
ssh homelab "docker system df"

# Network connectivity
ssh homelab "ping -c 3 8.8.8.8 && curl -I https://google.com"

# Check mount status
ssh homelab "mount | grep hdd && ls /mnt/hdd"

# View dmesg for hardware issues
ssh homelab "dmesg | tail -50"
```

---

## Resource Limits & Logging

### Memory Limits

Services with memory limits to prevent runaway resource usage:

| Service | Limit | Reserved |
|---------|-------|----------|
| [redacted] | 4G | - |
| Immich Server | 4G | - |
| Immich ML | 4G | - |
| Calibre | 2G | - |
| UptimeKuma | 512M | 256M |

### Log Rotation

Services with JSON file logging and rotation configured:

| Service | Max Size | Max Files |
|---------|----------|-----------|
| docker-socket-proxy | 10m | 2 |
| [redacted] | 50m | 5 |
| Immich Server | 50m | 5 |
| [redacted] | 20m | 3 |
| [redacted] | 20m | 3 |

---

## Agent Behavioral Guidelines

### Always Do

- **Read before modify:** Check current state before making changes
- **Confirm destructive operations:** Ask before `docker compose down`, reboots, or data deletion
- **Use Doppler prefix:** All docker compose commands need `doppler run --`
- **Test incrementally:** Apply changes one service at a time when possible
- **Verify after changes:** Check service health after any modification
- **Reference README.md:** For detailed setup procedures, not this file
- **Run `/docs` before commits:** Update documentation when changing infrastructure or scripts

### Never Do

- **Commit without `/commit`:** Wait for explicit commit request
- **Expose secrets:** Never log, echo, or include secrets in output
- **Skip SSH:** Always execute server commands via SSH, not locally
- **Force reboot remotely:** Physical access is limited - reboots are risky
- **Modify watchdog credentials:** `/root/.homelab-watchdog-credentials` is sensitive
- **Delete data without confirmation:** Especially on `/mnt/hdd`

### Documentation Workflow

When making changes that affect infrastructure or script behavior:

1. Make the code changes
2. Run `/docs` to audit and update documentation
3. Review changes with `git diff`
4. Commit with `/commit` when satisfied

**Documentation locations:**
- `README.md` - Setup procedures, detailed guides
- `CLAUDE.md` - Quick reference, agent instructions
- `docs/*.md` - Detailed behavior documentation for complex scripts

### Confirmation Required For

- System reboots or shutdowns
- Removing containers with volumes (`docker compose down -v`)
- Modifying encrypted HDD mount configuration
- Changing Cloudflare tunnel settings
- Any operation affecting all services simultaneously

---

## Quick Reference Card

### SSH Access

| Command | Purpose |
|---------|---------|
| `ssh homelab` | HomeLab via Tailscale (${HOMELAB_TAILSCALE_IP}) |
| `ssh vps` | VPS via Tailscale (100.82.157.104) |
| `ssh homelab-direct` | BLOCKED — UFW denies non-Tailscale SSH |
| `ssh vps-direct` | BLOCKED — Hetzner FW blocks port 22 (use web console) |

### Docker Operations

| Command | Purpose |
|---------|---------|
| `docker compose ps` | View all services |
| `doppler run -- docker compose up -d` | Start all services |
| `doppler run -- docker compose restart <service>` | Restart single service |
| `docker compose logs -f <service>` | View service logs |
| `doppler run -- docker compose up -d --force-recreate <service>` | Rebuild after config change |

### System Health

| Command | Purpose |
|---------|---------|
| `df -h && free -h && uptime` | Check resources |
| `docker stats --no-stream` | Container resource usage |
| `docker system df` | Docker disk usage |
| `mount \| grep hdd && ls /mnt/hdd` | Mount status |
| `dmesg \| tail -50` | Kernel logs (HDD issues) |

### Watchdog Management

| Command | Purpose |
|---------|---------|
| `cat /var/lib/homelab_watchdog/state` | View escalation state (0-4) |
| `tail -f /var/log/homelab_watchdog.log` | View watchdog logs |
| `sudo rm /var/lib/homelab_watchdog/manual_intervention_required` | Resume auto-recovery |
| `echo 0 \| sudo tee /var/lib/homelab_watchdog/state` | Reset to healthy |

### Container Updates (Watchtower)

**Update tiers:**
- **Opted-out** (manual via `/upgrade-stack`): `immich_server`, `immich_ml`, `immich_redis`, `immich_postgres`, `signoz`, `signoz-otel-collector`, `zookeeper-1`, `clickhouse`, `plausible`
- **Opted-out** (other): `caddy` (custom build), `docker-socket-proxy-watchtower`, `watchtower` itself
- **Auto-update** (global, daily 4AM): everything else

| Command | Purpose |
|---------|---------|
| `docker logs watchtower --tail=50` | Watchtower recent activity |

### [redacted] ([redacted]s)

| Command | Purpose |
|---------|---------|
| `docker exec [redacted] [redacted]-remote -l` | List all [redacted]s |
| `docker exec [redacted] [redacted]-remote -a 'magnet:?...'` | Add magnet link |
| `docker exec [redacted] [redacted]-remote -t <id> -r` | Remove [redacted] |
| `docker exec [redacted] cat /tmp/[redacted]/ip` | Check VPN IP |
| `./scripts/[redacted]_manager.py` | Interactive [redacted] manager |

### Uptime Kuma Config-as-Code

> **IMPORTANT:** sync.py must run ON THE HOMELAB SERVER — it connects to localhost:3010. Never run locally or on VPS.

| Command | Purpose |
|---------|---------|
| `ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --dry-run"` | Preview changes |
| `ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py"` | Apply changes |
| `ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --export"` | Export to YAML |

### SigNoz (Observability)

| Command | Purpose |
|---------|---------|
| `docker logs clickhouse --tail 50` | Check ClickHouse logs |
| `docker logs signoz-query-service --tail 50` | Check SigNoz UI/API logs |
| `docker logs signoz-otel-collector --tail 50` | Check OTLP ingestion logs |
| `curl -I https://signoz.jkrumm.com` | Test SigNoz UI (private) |
| `curl -I https://otlp.jkrumm.com/v1/traces` | Test OTLP endpoint (public) |
| `docker stats --no-stream \| grep signoz` | Check SigNoz resource usage |
| `du -sh /home/jkrumm/ssd/signoz/*` | Check SigNoz disk usage |

### HDD Operations

| Command | Purpose |
|---------|---------|
| `sudo ./scripts/check_hdd.sh` | Run 7-step HDD verification |
| `sudo cryptsetup status encrypted_partition` | Check LUKS status |

### Git Workflow (Local Edit → Remote Deploy)

```bash
# 1. Edit locally, commit, push
git add . && git commit -m "message" && git push

# 2. Pull and apply on server
ssh homelab "cd ~/homelab && git pull && doppler run -- docker compose up -d"
```

### Emergency Commands

```bash
# Restart all Docker services
ssh homelab "cd ~/homelab && docker compose down && doppler run -- docker compose up -d"

# Clear watchdog and resume auto-recovery
ssh homelab "sudo rm /var/lib/homelab_watchdog/manual_intervention_required && echo 0 | sudo tee /var/lib/homelab_watchdog/state"

# Force container recreation
ssh homelab "cd ~/homelab && doppler run -- docker compose up -d --force-recreate"

# Aggressive Docker cleanup (careful!)
ssh homelab "docker system prune -af"
```
