# Homelab Setup Guide

## Quick Commands Cheatsheet

### SSH Access

```bash
# HomeLab - via Tailscale (primary)
ssh homelab

# VPS - via Tailscale (primary)
ssh vps

# Direct SSH is blocked on both machines:
#   homelab-direct — blocked by UFW (SSH restricted to Tailscale only)
#   vps-direct     — blocked by Hetzner Cloud Firewall (SSH rule removed)
# Emergency access: Hetzner web console (VPS), physical access (HomeLab)

# Samba file shares (via Tailscale DNS)
# Finder → Cmd+K → smb://samba.jkrumm.com
# Or via SSH tunnel: ssh -L 1445:localhost:445 homelab → smb://localhost:1445
```

### Docker Operations

```bash
# View all services
docker compose ps

# Start all services
doppler run -- docker compose up -d

# Restart single service
doppler run -- docker compose restart <service>

# View service logs (follow)
docker compose logs -f <service>

# Rebuild after config change
doppler run -- docker compose up -d --force-recreate <service>

# Full restart (after docker-compose.yml changes)
docker compose down && doppler run -- docker compose up -d

# Pull latest images and restart
docker compose pull && doppler run -- docker compose up -d
```

### Git Workflow (Edit Local → Deploy Remote)

```bash
# 1. Edit locally, commit, push
git add . && git commit -m "message" && git push

# 2. Pull and apply on server
ssh homelab "cd ~/homelab && git pull && doppler run -- docker compose up -d"
```

### System Health

```bash
# Check resources
ssh homelab "df -h && free -h && uptime"

# Docker disk usage
ssh homelab "docker system df"

# Container resource usage
ssh homelab "docker stats --no-stream"

# Mount status
ssh homelab "mount | grep hdd && ls /mnt/hdd"

# Kernel logs (HDD issues)
ssh homelab "dmesg | tail -50"
```

### Watchdog Management

```bash
# View current escalation state (0-4)
ssh homelab "cat /var/lib/homelab_watchdog/state"

# View watchdog logs
ssh homelab "tail -f /var/log/homelab_watchdog.log"

# Clear manual intervention flag (resume auto-recovery)
ssh homelab "sudo rm /var/lib/homelab_watchdog/manual_intervention_required"

# Reset state to healthy
ssh homelab "echo 0 | sudo tee /var/lib/homelab_watchdog/state"

# Check daily reboot count
ssh homelab "cat /var/lib/homelab_watchdog/reboot_tracker"
```

### Container Diagnostics

```bash
# Container health status
ssh homelab "docker inspect --format='{{.State.Health.Status}}' <container>"

# Execute command in container
ssh homelab "docker exec -it <container> sh"

# View container network info
ssh homelab "docker inspect <container> | grep -A 20 NetworkSettings"
```


```bash
# NOTE: sync.py must run ON THE HOMELAB SERVER — it connects to localhost:3010. Never run locally or on VPS.

# Preview changes (dry run)
ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --dry-run"

# Apply changes
ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py"

# Export current monitors to YAML
ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --export"
```

### SigNoz (Observability)

```bash
# Access SigNoz UI (Tailscale only)
# Browser: https://signoz.jkrumm.com

# Check SigNoz containers
ssh homelab "docker compose ps | grep signoz"

# View SigNoz Query Service logs
ssh homelab "docker compose logs -f signoz-query-service"

# View OTel Collector logs
ssh homelab "docker compose logs -f signoz-otel-collector"

# View ClickHouse logs
ssh homelab "docker compose logs -f clickhouse"

# Check ClickHouse storage usage
ssh homelab "du -sh /home/jkrumm/ssd/signoz/clickhouse"

# Verify OTLP endpoint (public)
curl -I https://otlp.jkrumm.com/v1/traces

# Test OTLP endpoint with sample trace
curl -X POST https://otlp.jkrumm.com/v1/traces \
  -H "Content-Type: application/json" \
  -d '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"test-service"}}]},"scopeSpans":[{"spans":[{"traceId":"00000000000000000000000000000001","spanId":"0000000000000001","name":"test-span","kind":1,"startTimeUnixNano":"1609459200000000000","endTimeUnixNano":"1609459200100000000"}]}]}]}'

# Check SigNoz resource usage
ssh homelab "docker stats --no-stream clickhouse signoz-query-service signoz-otel-collector signoz-alertmanager"

# Query ClickHouse directly
ssh homelab "docker exec clickhouse clickhouse-client --query 'SELECT version()'"

# Check retention settings
ssh homelab "docker exec signoz-query-service env | grep RETENTION"
```

### ntfy Notifications

#### Active Topics

| Topic | Producer | Purpose |
|-|-|-|
| `homelab-watchdog` | `homelab_watchdog.sh` (host cron) | System health alerts (disk, internet, containers, Tailscale) |
| `homelab-watchtower` | HomeLab Watchtower | Container update notifications |
| `vps-watchtower` | VPS Watchtower | VPS container update notifications |
| `uptime-alerts` | UptimeKuma | Service down/up alerts |

All topics are reserved by `jkrumm` on the server (50-slot `homelab` tier).

#### Adding a New Topic

1. **Reserve it** (ensures it appears as owned in iOS/web apps):
   ```bash
   ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
     curl -s -X POST \
       -H "Authorization: Bearer ${NTFY_TOKEN}" \
       -H "Content-Type: application/json" \
       "https://ntfy.jkrumm.com/v1/account/reservation" \
       -d "{\"topic\":\"my-new-topic\",\"everyone\":\"deny-all\"}"
   '"'"''
   ```

2. **Update the topics table** in `uptime-kuma/monitors.yaml` if you want a health monitor for it.

3. **Update the topics table** in `.claude/commands/ntfy.md` and this README.

4. **Subscribe** in the iOS app or web UI — it will appear in the reserved topics list.

#### Quick Publish / Test

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s \
    -H "Authorization: Bearer ${NTFY_TOKEN}" \
    -H "Title: Test" \
    -H "Tags: white_check_mark" \
    -d "ntfy is working" \
    https://ntfy.jkrumm.com/homelab-watchdog
'"'"''
```

#### Web / iOS Access

- **Web UI / PWA:** https://ntfy.jkrumm.com → Log in as `jkrumm` (password in Doppler `NTFY_PASSWORD`)
- **iOS app:** Settings → Manage Users → add `https://ntfy.jkrumm.com` with `jkrumm` + `NTFY_PASSWORD`
- **iOS push relay:** via `ntfy.sh` APNs — notifications arrive even when the app is closed

---

### HDD Diagnostics

```bash
# Run 7-step HDD verification
ssh homelab "sudo ~/homelab/scripts/check_hdd.sh"

# Check LUKS encryption status
ssh homelab "sudo cryptsetup status encrypted_partition"

# Manually unlock encrypted partition
ssh homelab "sudo cryptsetup luksOpen /dev/sdb2 encrypted_partition --key-file /root/.hdd-keyfile"

# Mount HDD manually
ssh homelab "sudo mount /dev/mapper/encrypted_partition /mnt/hdd"
```

### Database Backup

```bash
# Run backup manually
ssh homelab "sudo ~/homelab/scripts/backup_fpp_db.sh"

# View backup log
ssh homelab "tail -f /mnt/hdd/backups/backup.log"

# Check backup file
ssh homelab "ls -la /mnt/hdd/backups/fpp.sql"
```

### Doppler Secrets

```bash
# View all secrets
doppler secrets

# Get specific secret
doppler secrets get CLOUDFLARE_TOKEN

# Run command with secrets
doppler run -- env | grep POSTGRES
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

---

## Table of Contents

1. [Quick Commands Cheatsheet](#quick-commands-cheatsheet)
    - [SSH Access](#ssh-access)
    - [Docker Operations](#docker-operations)
    - [Git Workflow](#git-workflow-edit-local--deploy-remote)
    - [System Health](#system-health)
    - [Watchdog Management](#watchdog-management)
    - [Container Diagnostics](#container-diagnostics)
    - [Uptime Kuma Config-as-Code](#uptime-kuma-config-as-code)
    - [SigNoz (Observability)](#signoz-observability)
    - [HDD Diagnostics](#hdd-diagnostics)
    - [Database Backup](#database-backup)
    - [Doppler Secrets](#doppler-secrets)
    - [Emergency Commands](#emergency-commands)
2. [Infrastructure Overview](#infrastructure-overview)
    - [Service Access Cheatsheet](#service-access-cheatsheet)
3. [Security Hardening](#security-hardening)
4. [Documentation](#documentation)
5. [Docker Socket Security](#docker-socket-security)
6. [Tailscale + Caddy Migration](#tailscale--caddy-migration)
7. [TODOs](#todos)
8. [Doppler Secrets](#doppler-secrets-1)
10. [Setup Guide](#setup-guide)
    - [Install Ubuntu Server](#install-ubuntu-server)
    - [Initial Setup on Ubuntu Server](#initial-setup-on-ubuntu-server)
    - [Connect to the Server](#connect-to-the-server)
    - [Configure Doppler](#configure-doppler)
11. [Reusing an Existing Encrypted HDD](#reusing-an-existing-encrypted-hdd)
12. [Mount the TRANSFER Partition](#mount-the-transfer-partition)
13. [File Access](#file-access)
15. [Setup Beszel](#setup-beszel)
16. [Setup Dozzle](#setup-dozzle)
17. [Setup UptimeKuma](#setup-uptimekuma)
18. [Setup Duplicati](#setup-duplicati)
19. [Setup Database Backup](#setup-database-backup)
20. [Setup HomeLab self healing watchdog](#setup-homelab-self-healing-watchdog)
21. [Setup Calibre and Calibre-Web](#setup-calibre-and-calibre-web)
22. [Setup Immich](#setup-immich)
23. [Setup ExcaliDash](#setup-excalidash)
24. [Setup Public Files (Dufs)](#setup-public-files-dufs)
25. [Setup Obsidian (Always-On)](#setup-obsidian-always-on)

---

## Infrastructure Overview

Two machines, connected via Tailscale mesh VPN, serving 29+ containers.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        HomeLab (Ubuntu 24.04)                       │
│                     Tailscale IP: <tailscale-ip-homelab>                    │
│                                                                      │
│  Public:   Internet → Cloudflare CDN → CF Tunnel → caddy:80 → app   │
│  Private:  Tailscale device → caddy:443 (HTTPS, Let's Encrypt) → app │
│                                                                      │
│  27 containers: Glance, Immich, Calibre, ntfy, ...                   │
│  Storage: Internal SSD + Encrypted external HDD                      │
│  Watchdog: Self-healing monitor (cron, 10min)                        │
├──────────────────────────────────────────────────────────────────────┤
│                        VPS (Hetzner ARM64, Ubuntu 22.04)             │
│                     Tailscale IP: <tailscale-ip-sds>                    │
│                                                                      │
│  Public:   Internet → Cloudflare CDN → CF Tunnel → caddy:80 → app   │
│  MariaDB:  Vercel → port 33306 (direct, Hetzner FW allows)          │
│                                                                      │
│  11 containers: FPP, Analytics, Snow-Finder, Plausible, MariaDB, ... │
├──────────────────────────────────────────────────────────────────────┤
│                        Cross-Machine Links                           │
│  Dozzle hub (HomeLab) ←→ Dozzle agent (VPS)  via Tailscale          │
│  Beszel hub (HomeLab) ←→ Beszel agent (VPS)  via Tailscale          │
└──────────────────────────────────────────────────────────────────────┘
```

### Service Access Cheatsheet

#### HomeLab — Public Services (anyone can access)

| Service | URL | Purpose |
|---------|-----|---------|
| Glance | [glance.jkrumm.com](https://glance.jkrumm.com) | Home dashboard |
| Immich | [immich.jkrumm.com](https://immich.jkrumm.com) | Photo management |
| UptimeKuma | [uptime.jkrumm.com](https://uptime.jkrumm.com) | Status page |
| ExcaliDash | [draw.jkrumm.com](https://draw.jkrumm.com) | Whiteboard |
| Dufs | [public.jkrumm.com](https://public.jkrumm.com) | Public file server |
| OTLP Ingestion | [otlp.jkrumm.com](https://otlp.jkrumm.com) | OpenTelemetry trace ingestion (for browser apps) |
| ntfy | [ntfy.jkrumm.com](https://ntfy.jkrumm.com) | Push notifications (iOS + PWA, auth required) |

**Route:** Internet → Cloudflare CDN (proxied/orange cloud) → CF Tunnel → `http://caddy:80` → container

#### HomeLab — Private Services (Tailscale devices only)

| Service | URL | Purpose |
|---------|-----|---------|
| Beszel | [beszel.jkrumm.com](https://beszel.jkrumm.com) | System metrics |
| Dozzle | [dozzle.jkrumm.com](https://dozzle.jkrumm.com) | Container logs |
| Duplicati | [duplicati.jkrumm.com](https://duplicati.jkrumm.com) | Backup management |
| FileBrowser | [files.jkrumm.com](https://files.jkrumm.com) | File management |
| Calibre GUI | [calibre.jkrumm.com](https://calibre.jkrumm.com) | Book management admin |
| Calibre-Web | [books.jkrumm.com](https://books.jkrumm.com) | E-book library |
| SigNoz | [signoz.jkrumm.com](https://signoz.jkrumm.com) | Application observability (APM) |
| Obsidian | [obsidian.jkrumm.com](https://obsidian.jkrumm.com) | Obsidian app (KasmVNC GUI + REST API + TaskNotes API) |
| CouchDB | [couchdb.jkrumm.com](https://couchdb.jkrumm.com) | Obsidian LiveSync database |

**Route:** Tailscale device → DNS A record → HomeLab TS IP (<tailscale-ip-homelab>) → `https://caddy:443` → container

**DNS:** Grey cloud (DNS-only) A records pointing to `<tailscale-ip-homelab>`. Unreachable from public internet.

**TLS:** Caddy obtains Let's Encrypt certificates via Cloudflare DNS-01 challenge.

#### HomeLab — Internal Services (no direct web access)

| Service | Purpose |
|---------|---------|
| Caddy | Reverse proxy (custom build with `caddy-dns/cloudflare` plugin) |
| Cloudflared | CF Tunnel client (public services only) |
| Cloudflare-DDNS | Dynamic DNS for `homelab.jkrumm.com` |
| Docker Socket Proxy | Read-only Docker API proxy for monitoring |
| Watchtower | Auto-updates containers daily at 4AM; opted-out stacks (SigNoz, Immich, Plausible) updated manually via `/upgrade-stack`; ntfy notifications at `warn` level |
| ntfy | Self-hosted push notification server — iOS app, PWA, and Web Push; topics: homelab-watchdog, homelab-watchtower, vps-watchtower, uptime-alerts |
| Samba | SMB3 file shares (Tailscale only, `smb://samba.jkrumm.com`) |
| Beszel Agent | System metrics collector (Tailscale port binding) |
| Immich ML/Postgres/Redis | Immich supporting services |
| ExcaliDash Backend | ExcaliDash API + SQLite |
| ClickHouse | SigNoz datastore (traces, metrics, logs) |
| SigNoz Query Service | SigNoz backend API + UI |
| SigNoz OTel Collector | OpenTelemetry ingestion gateway |
| SigNoz Alert Manager | Alert rules and notifications |
| Plausible | Web analytics (shared ClickHouse + Immich Postgres) |
| CouchDB | Obsidian LiveSync database |

#### VPS — Public Services

| Service | URL | Purpose |
|---------|-----|---------|
| FPP Server | [fpp-server.jkrumm.com](https://fpp-server.jkrumm.com) | Free Planning Poker API |
| FPP Analytics | [fpp-analytics.jkrumm.com](https://fpp-analytics.jkrumm.com) | Analytics dashboard |
| Snow Finder | [snow-finder.jkrumm.com](https://snow-finder.jkrumm.com) | Snow conditions app |
| Photos | [photos.jkrumm.com](https://photos.jkrumm.com) | Photo gallery |
| Plausible | [plausible.jkrumm.com](https://plausible.jkrumm.com) | Privacy-friendly analytics |
| MariaDB | `5.75.178.196:33306` | Database (direct access for Vercel) |

#### Tailscale Devices

| Device | Tailscale IP | SSH |
|--------|-------------|-----|
| HomeLab | <tailscale-ip-homelab> | `ssh homelab` |
| VPS | <tailscale-ip-sds> | `ssh vps` |
| MacBook | <tailscale-ip-macbook> | — |
| iPhone | <tailscale-ip-iphone> | — |

---

## Security Hardening

Both machines are hardened with identical security configurations (applied via `setup.sh` scripts):

| Component | Configuration |
|-----------|--------------|
| **SSH** | Drop-in at `/etc/ssh/sshd_config.d/99-hardening.conf`: PermitRootLogin no, PasswordAuthentication no, MaxAuthTries 3, X11/Agent/TcpForwarding disabled |
| **UFW** | Default deny incoming. SSH restricted to Tailscale CGNAT range (`100.64.0.0/10`). HomeLab: Samba also Tailscale-only. VPS: HTTPS + MariaDB open |
| **fail2ban** | Enabled (sshd jail) |
| **sysctl** | kptr_restrict=2, dmesg_restrict=1, ptrace_scope=2, rp_filter=1, log_martians=1, send_redirects=0, unprivileged_bpf_disabled=1 |
| **unattended-upgrades** | Security updates auto-installed. Docker packages blacklisted. Auto-reboot at 4 AM if kernel update pending |
| **Docker** | `no-new-privileges:true` on all containers (except host-network agents). Memory limits on resource-heavy services. JSON log rotation |
| **Hetzner FW** | VPS only: 2 rules — HTTPS (443) + MariaDB (33306). SSH removed (Tailscale-only access) |

**Emergency access:**
- HomeLab: Physical access at remote location
- VPS: Hetzner web console (no SSH needed)

---

## Documentation

Detailed behavior documentation for complex scripts is maintained in the `docs/` directory:

| Document | Purpose |
|----------|---------|
| `docs/watchdog-behaviors.md` | Failure scenarios, escalation states, recovery paths for the self-healing watchdog |

**Maintaining documentation:**
- Run `/docs` command (via Claude Code) after infrastructure changes
- Update behavior docs when script logic changes
- Keep cheatsheets in sync with actual commands

---

## Docker Socket Security

Monitoring services access the Docker API through a secure proxy instead of direct socket mounts:

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    socket-proxy network (internal)          │
│                                                             │
│  ┌──────────────────┐                                       │
│  │ docker-socket-   │◄─── tcp://docker-socket-proxy:2375    │
│  │ proxy            │                                       │
│  │ (read-only)      │◄─── /var/run/docker.sock:ro          │
│  └──────────────────┘                                       │
│           ▲                                                 │
│           │                                                 │
│  ┌────────┴────────┬──────────────┬──────────────┐         │
│  │                 │              │              │         │
│  ▼                 ▼              ▼              ▼         │
│ Glance          Dozzle     Beszel-Agent    UptimeKuma      │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Watchtower (dedicated proxy - needs write for auto-updates) │
│                                                             │
│ docker-socket-proxy-watchtower (POST=1) ◄── Isolated net   │
└─────────────────────────────────────────────────────────────┘
```

### Why This Matters

Direct Docker socket access (`/var/run/docker.sock`) grants full root-level control:
- Container creation with host mounts
- Privilege escalation via container escape
- Host filesystem access

The proxy (`tecnativa/docker-socket-proxy`) restricts access to read-only operations:
- ✅ CONTAINERS, IMAGES, INFO, NETWORKS, VOLUMES (read)
- ❌ POST, BUILD, EXEC, COMMIT, etc. (disabled)

### Service Configuration

Services connect via environment variable:
```yaml
environment:
  DOCKER_HOST: tcp://docker-socket-proxy:2375
networks:
  - socket-proxy
depends_on:
  - docker-socket-proxy
```

**Exception:** Watchtower requires write access to pull and restart containers. It uses a dedicated `docker-socket-proxy-watchtower` (POST=1) on an isolated network — not a direct socket mount.

---

## Tailscale + Caddy Migration

Private services moved from Cloudflare tunnel to Tailscale-only access. Caddy serves as reverse proxy for all services. See `docs/TAILSCALE.md` for full migration plan and learnings.

**Tailnet:** `dinosaur-sole.ts.net`

### Progress

| Phase | Description | Status |
|-------|-------------|--------|
| 1-7 | Tailscale + SSH + Caddy + routing + private services + VPS + cross-machine | Done |
| 8 | SSH config + Zed remote development | SSH Done, Zed Pending |
| 9 | Documentation updates | Done |
| 10 | Cleanup: ports, deps, Samba label, watchdog | Done |
| 11 | SSH hardening + UFW + sysctl + unattended-upgrades (both machines) | Done |

### Service Classification

| Service | Access | Domain |
|---------|--------|--------|
| Glance | Public (Cloudflare) | glance.jkrumm.com |
| Immich | Public (Cloudflare) | immich.jkrumm.com |
| UptimeKuma | Public (Cloudflare) | uptime.jkrumm.com |
| ExcaliDash | Public (Cloudflare) | draw.jkrumm.com |
| Dufs | Public (Cloudflare) | public.jkrumm.com |
| Beszel | Private (Tailscale) | beszel.jkrumm.com |
| Dozzle | Private (Tailscale) | dozzle.jkrumm.com |
| Duplicati | Private (Tailscale) | duplicati.jkrumm.com |
| FileBrowser | Private (Tailscale) | files.jkrumm.com |
| Calibre GUI | Private (Tailscale) | calibre.jkrumm.com |
| Calibre-Web | Private (Tailscale) | books.jkrumm.com |
| SigNoz | Private (Tailscale) | signoz.jkrumm.com |
| Obsidian | Private (Tailscale) | obsidian.jkrumm.com |
| CouchDB | Private (Tailscale) | couchdb.jkrumm.com |

### Tailscale IPs

| Machine | Tailscale IP | MagicDNS |
|---------|-------------|----------|
| MacBook | <tailscale-ip-macbook> | iu-mac-book |
| iPhone | <tailscale-ip-iphone> | iphone-15 |
| HomeLab | <tailscale-ip-homelab> | homelab.dinosaur-sole.ts.net |
| VPS | <tailscale-ip-sds> | sideproject-docker-stack.dinosaur-sole.ts.net |

---

## TODOS
- [ ] Backup my Photoflow images to HomeLab

## Service Routing

All services are routed through **Caddy** (custom build with `caddy-dns/cloudflare` plugin). The `Caddyfile` is the single source of truth for routing. See [Service Access Cheatsheet](#service-access-cheatsheet) above for the full list of services and how to access them.

## Doppler Secrets

The following secrets are required to run the HomeLab:

| Name                   | Description                          | Example                                |
|------------------------|--------------------------------------|----------------------------------------|
| `CLOUDFLARE_TOKEN`     | Cloudflare tunnel token              | `tunnel-token-from-dashboard`          |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token for DDNS       | `api-token-for-dns-updates`            |
| `DB_HOST`              | MySQL server host for backups       | `5.75.178.196`                         |
| `DB_ROOT_PW`           | MySQL root password                  | `your-secure-password`                 |
| `POSTGRES_DB_PASSWORD` | Immich Postgres password             | `your-secure-postgres-password`        |
| `DUFS_PASSWORD`        | Dufs public file server auth         | `your-secure-dufs-password`            |
| `COUCHDB_PASSWORD`     | CouchDB admin password               | `your-secure-couchdb-password`         |
| `OBSIDIAN_GUI_PASSWORD`| Obsidian KasmVNC GUI password        | `your-secure-obsidian-password`        |

## Setup Guide

### Install Ubuntu Server

1. Download the Ubuntu Server ISO from the [official website](https://ubuntu.com/download/server).
2. Create a bootable USB drive using [Rufus](https://rufus.ie/) or [Balena Etcher](https://www.balena.io/etcher/).
3. Boot from the USB drive and install Ubuntu Server.
4. Follow the on-screen instructions to complete the installation:
    - Hostname: homelab
    - Username: jkrumm
    - Password: Use a strong password
    - Partitioning: Use the entire disk and set up LVM
    - Software selection: OpenSSH server, standard system utilities
    - Additional packages: Install security updates automatically
5. Reboot the server and log in using the credentials you created during the installation.
6. Update the system using the following commands:
   ```bash
   sudo apt update
   sudo apt upgrade -y
   ```

### Initial Setup on Ubuntu Server

1. Install Git:

   ```bash
   sudo apt install git -y
   ```

2. Configure git credential storage:

   ```bash
   git config --global credential.helper store
   ```

3. Clone the private repository:

   ```bash
   git clone https://github.com/jkrumm/homelab.git
   ```

   When prompted for credentials:
   - Username: `jkrumm`
   - Password: Use the Personal Access Token (PAT) from 1Password (GitHub login)

   The credentials will be saved automatically and you won't be prompted again for future pulls.

4. Change to the repository directory:

   ```bash
   cd homelab
   ```

4. Adjust your public SSH key in the `setup.sh` script.
5. Run the setup script with sudo:

   ```bash
   chmod +x setup.sh
   sudo ./setup.sh
   ```

   The setup script handles all security hardening automatically:
   - SSH hardening (PermitRootLogin no, PasswordAuthentication no, MaxAuthTries 3)
   - UFW firewall (SSH + Samba restricted to Tailscale only)
   - fail2ban, sysctl hardening, unattended-upgrades

### Connect to the Server

The `setup.sh` script configures the firewall to allow SSH connections. You can now connect to the server using the
command printed at the end of the script.

### Configure Cloudflare Tunnel

1. Set up Cloudflare tunnel in your Cloudflare dashboard:
   - Create a new tunnel
   - Get the tunnel token
   - Configure DNS records to point to the tunnel
   - Set up service routing for each subdomain to the appropriate local ports

2. Add the tunnel token to your Doppler secrets as `CLOUDFLARE_TOKEN`

3. The docker-compose.yml includes the cloudflared service which will automatically connect using the token

### Configure Doppler

1. [Install Doppler CLI](https://docs.doppler.com/docs/install-cli)
2. Verify the installation:

   ```bash
   doppler --version
   ```

3. Authenticate with Doppler:

   ```bash
   doppler login
   ```

4. Set the Doppler project:

   ```bash
   doppler setup
   ```

5. Print the Doppler configuration and verify all secrets above are set:

   ```bash
   doppler configs
   doppler secrets
   ```

## Reusing an Existing Encrypted HDD

This guide explains how to configure your new server setup to automatically decrypt and mount an existing LUKS-encrypted
HDD using a previously backed-up keyfile.

### Prerequisites

- LUKS-encrypted HDD: You have an existing encrypted HDD.
- Keyfile: The keyfile is backed up in 1Password.
- Root access: Required for configuration changes.

### Step-by-Step Configuration

#### Restore the Keyfile

Retrieve the keyfile content from your 1Password backup and save it to `/root/.hdd-keyfile` on your new server:

```bash
sudo vim /root/.hdd-keyfile
```

Paste the keyfile content into the file. Secure the keyfile by setting the appropriate permissions:

```bash
sudo chmod 600 /root/.hdd-keyfile
```

#### Identify the Encrypted Partition

Use `blkid` to find the UUID of your encrypted partition:

```bash
sudo blkid
```

Note the UUID of the LUKS-encrypted partition (e.g., `/dev/sdb2`).

#### Configure `/etc/crypttab`

Edit `/etc/crypttab` to set up automatic decryption:

```bash
sudo vim /etc/crypttab
```

Add the following line, replacing `<UUID>` with the UUID from the previous step:

```bash
encrypted_partition UUID=<UUID> /root/.hdd-keyfile luks
```

#### Configure `/etc/fstab`

Edit `/etc/fstab` to ensure the partition is mounted at boot:

```bash
sudo vim /etc/fstab
```

Add the following line to mount the decrypted partition, adjusting the mount point as needed:

```bash
/dev/mapper/encrypted_partition /mnt/hdd ext4 defaults,uid=1000,gid=1000 0 2
```

Make sure the mount point directory exists:

```bash
sudo mkdir -p /mnt/hdd
```

#### Reboot and Verify

Reboot your system to check if everything is configured correctly:

```bash
sudo reboot
```

After rebooting, verify that the partition is automatically decrypted and mounted:

```bash
df -h | grep hdd
```

Update the permissions of the mounted partition:

```bash
sudo chown -R 1000:1000 /mnt/hdd
sudo chmod -R 755 /mnt/hdd
```

If it doesn't mount automatically, check the system logs for errors:

```bash
sudo journalctl -xe
```

### Mount automatically with new systemd service

For a more automated and reliable solution, follow the steps to create a `systemd` service:

1. **Create a Mount Script:**

   Save the following script as `/usr/local/bin/mount_hdd.sh`:

   ```bash
   #!/bin/bash
   if ! mount | grep -q '/mnt/hdd'; then
       mount /dev/mapper/encrypted_partition /mnt/hdd
   fi
   ```

   Make the script executable:

   ```bash
   sudo chmod +x /usr/local/bin/mount_hdd.sh
   ```

2. **Create a Systemd Service File:**

   Create a service file at `/etc/systemd/system/mount-hdd.service`:

   ```ini
   [Unit]
   Description=Mount Encrypted HDD
   Before=docker.service
   After=systemd-cryptsetup@encrypted_partition.service

   [Service]
   Type=oneshot
   ExecStart=/usr/local/bin/mount_hdd.sh
   RemainAfterExit=yes

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable the Systemd Service:**

   Enable the service to start at boot:

   ```bash
   sudo systemctl enable mount-hdd.service
   ```

4. **Reboot and Verify:**

   Reboot your system to ensure the service works:

   ```bash
   sudo reboot
   ```

   After reboot, check if the partition is mounted:

   ```bash
   mount | grep /mnt/hdd
   ```

## Mount the `TRANSFER` Partition

1. Create the Mount Point

First, create the directory where you want to mount the `TRANSFER` partition:

```bash
sudo mkdir -p /mnt/transfer
```

2. Update `/etc/fstab`

Edit your `/etc/fstab` file to ensure the `TRANSFER` partition is mounted at boot:

```bash
sudo vim /etc/fstab
```

Add the following line at the end of the file to mount the `TRANSFER` partition. Replace `6785-1A1C` with the UUID of
your `TRANSFER` partition if it's different:

```bash
UUID=6785-1A1C /mnt/transfer exfat defaults,uid=1000,gid=1000 0 0
```

This line will mount the `TRANSFER` partition using the `exfat` filesystem with default options and set the owner to the
user with UID 1000 and group GID 1000.

3. Mount the Partition

To mount the partition immediately without rebooting, use the following command:

```bash
sudo mount /mnt/transfer
```

4. Verify the Mount

Check that the partition is correctly mounted using:

```bash
df -h | grep transfer
```

This command should show the `TRANSFER` partition mounted at `/mnt/transfer`.

5. Set Permissions (Optional)

If you need to adjust the permissions for the mounted partition, you can do so with:

```bash
sudo chown -R 1000:1000 /mnt/transfer
sudo chmod -R 755 /mnt/transfer
```

These commands set the owner and group to UID 1000 and GID 1000, and assign read, write, and execute permissions to the
owner, and read and execute permissions to the group and others.

### Summary

By following these steps, your `TRANSFER` partition will be automatically mounted at `/mnt/transfer` upon system boot.
You can adjust the options in `/etc/fstab` as needed to customize the mount behavior.

## File Access

This homelab provides multiple ways to access your files stored on the SSD (`/mnt/ssd/SSD`) and HDD (`/mnt/hdd`) partitions.

### Filebrowser (Web Interface)

Filebrowser provides a modern web interface for file management and is accessible via Cloudflare tunnel.

1. Create the filebrowser directory with correct permissions:
   ```bash
   sudo mkdir -p /mnt/hdd/filebrowser
   sudo chown -R 1000:1000 /mnt/hdd/filebrowser
   sudo chmod -R 755 /mnt/hdd/filebrowser
   ```

2. Start the container:
   ```bash
   doppler run -- docker compose up -d filebrowser
   ```

   Filebrowser will automatically create `filebrowser.db` and `settings.json` files in `/mnt/hdd/filebrowser/`.

3. Access Filebrowser:
   - URL: `https://files.jkrumm.com`
   - Default login: `admin` / `admin`
   - Change the default password immediately after first login
   - The interface provides access to both SSD and HDD directories under `/srv/`

### Samba (SMB File Sharing)

For traditional file sharing and local network access, Samba provides SMB3 protocol support with encryption.

**Security configuration:**
- Minimum protocol: SMB3 (blocks older, less secure SMB1/SMB2)
- Encryption: Preferred (encrypts data in transit when supported)
- macOS compatible with Time Machine-style features (fruit VFS module)

1. Create a specific SSD folder for Samba:
   ```bash
   sudo mkdir -p /home/jkrumm/ssd
   sudo chown -R 1000:1000 /mnt/ssd/samba
   sudo chmod -R 755 /mnt/ssd/samba
   ```

2. Access Samba shares (Tailscale devices only):
   - **Direct** (preferred): Finder → `Cmd+K` → `smb://samba.jkrumm.com`
   - **SSH tunnel** (fallback): `ssh -L 1445:localhost:445 homelab` → `smb://localhost:1445`
   - Username: jkrumm
   - Password: Available in 1Password and Doppler secrets
   - DNS: `samba.jkrumm.com` → `<tailscale-ip-homelab>` (Tailscale IP, DNS-only/grey cloud)
   - Samba ports (139, 445) restricted to Tailscale CGNAT range via UFW

### Usage Recommendations

- **Filebrowser**: Best for web-based file management, uploads, and remote access via browser
- **Samba**: Ideal for mounting network drives, bulk file operations, and integration with local applications

## Setup Beszel

1. Create a specific folder for Beszel data on the HDD:
   ```bash
   sudo mkdir -p /mnt/hdd/beszel
   sudo chown -R 1000:1000 /mnt/hdd/beszel
   chmod 755 /mnt/hdd/beszel
   ```
2. Setup correct drives for SSD and HDD

3. Access the Beszel server using the following credentials:
    - Host: `https://beszel.jkrumm.com`
    - Username: jkrumm
    - Password: You can find the secret in 1Password and Doppler

## Setup UptimeKuma

1. Create a specific folder for UptimeKuma data on the SSD:
   ```bash
   sudo mkdir -p /home/jkrumm/ssd/uptime-kuma
   sudo chown -R 1000:1000 /home/jkrumm/ssd/uptime-kuma
   chmod -R 755 /home/jkrumm/ssd/uptime-kuma
   ```

   **Why SSD?** UptimeKuma uses SQLite with Write-Ahead Logging (WAL). With multiple monitors checking every 60s, HDD seek times cause database lock timeouts, resulting in false positive failures. SSD storage eliminates these issues by reducing write latency 10-100x.

2. **Version:** Using `louislam/uptime-kuma:2` (stable 2.x). Watchtower handles auto-updates.

3. **Configuration optimizations:**
   - `SQLITE_BUSY_TIMEOUT=30000` (30s timeout for database locks)
   - `DOCKER_HOST=tcp://docker-socket-proxy:2375` (secure Docker API access)
   - Memory limits: 512M max, 256M reserved

   **Docker monitors:** Use TCP connection type in UptimeKuma UI:
   - Docker Host → Add new → TCP connection type
   - Connection URL: `tcp://docker-socket-proxy:2375`
   - This replaces direct socket access for security

4. **Monitor configuration:**

   | Priority | Interval | Timeout | Retries | Notes |
   |----------|----------|---------|---------|-------|
   | Critical | 60-70s | 90s | 3 | FPP, Photos, Plausible |
   | Standard | 120-190s | 120s | 5 | Docker containers, HTTP monitors |
   | Group | 200-215s | 120s | 3 | 3x child interval prevents "Child inaccessible" |

   **Key principles:**
   - **Stagger intervals** (60s, 65s, 70s) to avoid concurrent Cloudflare requests
   - **Group monitors**: 3x child interval minimum (e.g., 180s if children are 60s)
   - **HTTP Status Codes**: `200-299,304` to handle CDN/cache responses

5. **Cloudflare WAF bypass for external monitors:**

   Monitors hitting VPS services through Cloudflare tunnels need a WAF bypass to avoid ECONNRESET errors from bot protection.

   - **Header:** `X-Uptime-Monitor` with secret value (stored in 1Password → HomeLab)
   - **Cloudflare rule:** Security → WAF → Custom rules → Skip bot protection when header matches
   - **Affected monitors:** FPP-Frontend, FPP-Server, FPP-Analytics, Photos, Plausible

6. **Migrating from HDD?** If upgrading from HDD storage:
   ```bash
   docker compose stop uptime-kuma
   sudo rsync -av /mnt/hdd/uptimekuma/ /home/jkrumm/ssd/uptime-kuma/
   sudo chown -R 1000:1000 /home/jkrumm/ssd/uptime-kuma
   doppler run -- docker compose up -d uptime-kuma
   ```

7. **Database maintenance (optional):**
   ```bash
   docker compose stop uptime-kuma
   sqlite3 /home/jkrumm/ssd/uptime-kuma/kuma.db "PRAGMA optimize;"
   sqlite3 /home/jkrumm/ssd/uptime-kuma/kuma.db "VACUUM;"
   doppler run -- docker compose up -d uptime-kuma
   ```

8. **Diagnostic tools:**
   ```bash
   # Check DNS, SQLite, and monitor configurations
   ./scripts/fix_uptime_kuma_monitors.sh

   # Get container IPs for monitor URLs (optional optimization)
   ./scripts/get_container_ips.sh

   # Monitor logs for issues
   docker logs uptime-kuma -f | grep -iE "(warn|error)"
   ```

9. **Config as Code:**

   Monitors are defined in `uptime-kuma/monitors.yaml` and synced via Python script.
   **Must run ON THE HOMELAB SERVER** — connects to localhost:3010. Never run locally or on VPS.
   ```bash
   # Preview changes (dry run)
   ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --dry-run"

   # Apply changes
   ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py"

   # Export current monitors to YAML
   ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --export"
   ```

   **Setup (first time only):**
   ```bash
   cd ~/homelab
   python3 -m venv uptime-kuma/.venv
   uptime-kuma/.venv/bin/pip install -r uptime-kuma/requirements.txt
   ```

   **Required Doppler secrets:**
   - `UPTIME_KUMA_PASSWORD` - Admin password

   **Workflow:** Edit `monitors.yaml` → commit → push → run sync on homelab

## Setup Dozzle

### Setup certificates

1. Download cert.pem and key.pem from 1Password HomeLab
2. RSync them too the HomeLab and all VPS

    ```bash
    rsync -avz cert.pem key.pem jkrumm@{IP_OF_VPS}:/home/jkrumm/homelab 
    ```
3. Validate looking into the container logs if all good

### Dozzle Authentication Setup

To enable authentication for Dozzle:

1. Create a directory for Dozzle data:

   ```bash
   mkdir dozzle
   ```

2. Generate the password hash and create users.yml:

   ```bash
   # Generate password hash and copy the output
   docker run amir20/dozzle generate --name "Johannes Krumm" --email your@email.com --password your_password jkrumm

   # Create and edit users.yml file
   vim dozzle/users.yml
   ```

   Paste the output from the generate command into users.yml and save the file.

3. The docker-compose.yml is already configured with:

    - Simple authentication enabled
    - 48-hour login session
    - Volume mount for users.yml

4. After making these changes, restart Dozzle:
   ```bash
   docker compose up -d dozzle
   ```

You can now access Dozzle at https://dozzle.jkrumm.com and log in with username `jkrumm` and your chosen password.

### Viewing System Logs in Dozzle

Dozzle monitors Docker container logs. To view system log files (non-containerized logs) in Dozzle, we use a simple pattern:

Create an Alpine container that tails the log file. The container appears in Dozzle and streams the log file content.

**Currently monitored system logs:**
- **HomeLab Watchdog** (`homelab-watchdog-logs` container) → `/var/log/homelab_watchdog.log`
- **Database Backup** (`database-backup-logs` container) → `/mnt/hdd/backups/backup.log`

**To add additional log files:**

Add a new service to `docker-compose.yml`:

```yaml
  dozzle-your-log:
    container_name: your-log-name
    image: alpine
    volumes:
      - /path/to/your.log:/var/log/stream.log
    command:
      - tail
      - -f
      - /var/log/stream.log
    network_mode: none
    restart: unless-stopped
    labels:
      glance.hide: true
```

Then restart Docker Compose to apply:
```bash
doppler run -- docker compose up -d
```

## Setup Duplicati

1. Create a specific folder for Duplicati data on the HDD:
   ```bash
   sudo mkdir -p /mnt/hdd/duplicati
   sudo chown -R 1000:1000 /mnt/hdd/duplicati
   chmod 755 /mnt/hdd/duplicati
   ```
2. create a config and a backups folder in the duplicati folder
   ```bash
   sudo mkdir -p /mnt/hdd/duplicati/config
   sudo mkdir -p /mnt/transfer/duplicati_backups
   sudo chown -R 1000:1000 /mnt/hdd/duplicati/config
   sudo chown -R 1000:1000 /mnt/transfer/duplicati_backups
   sudo chmod -R 755 /mnt/hdd/duplicati/config
   sudo chmod -R 755 /mnt/transfer/duplicati_backups
   ```
3. Access the Duplicati server using the following credentials:

    - Host: `https://duplicati.jkrumm.com`
    - Username: jkrumm
    - Password: You can find the secret in 1Password and Doppler

4. Backups I run with Duplicati:
    - SSD
        - SSD LOCAL at 03:00
            - Destination: /source/mnt/transfer/duplicati_backups/SSD/
            - Source: /source/ssd/SSD/
            - Config: 100 MByte and intelligent persistence
            - IGNORE:
                - /source/ssd/SSD/Bilder/immich/upload/library
                - /source/ssd/SSD/Bilder/immich/postgres
                - /source/ssd/SSD/Bilder/immich/upload/encoded-video
                - /source/ssd/SSD/Bilder/immich/upload/profile
                - /source/ssd/SSD/Bilder/immich/upload/thumbs
        - SSD OneDrive at 03:30
            - Destination: jkrumm_duplicati_ssd
            - Source: /source/ssd/SSD/
            - Config: 50 MByte and intelligent persistence
            - IGNORE:
                - /source/ssd/SSD/Bilder/immich/upload/library
                - /source/ssd/SSD/Bilder/immich/postgres
                - /source/ssd/SSD/Bilder/immich/upload/encoded-video
                - /source/ssd/SSD/Bilder/immich/upload/profile
                - /source/ssd/SSD/Bilder/immich/upload/thumbs
    - HDD
        - HDD LOCAL at 02:30
            - Destination: /source/mnt/transfer/duplicati_backups/HDD/
            - Source: /source/mnt/hdd/
            - IGNORE: /source/mnt/hdd/Filme/
            - Config: 100 MByte and intelligent persistence
        - HDD OneDrive at 02:40
            - Destination: jkrumm_duplicati_hdd
            - Source: /source/mnt/hdd/
            - IGNORE: /source/mnt/hdd/Filme/
            - Config: 50 MByte and intelligent persistence

## Setup Database Backup

This guide explains how to set up automated MySQL database backups for the Free Planning Poker database.

#### Installation

1. The backup script is located in the repository at `scripts/backup_fpp_db.sh`. Make it executable:

   ```bash
   chmod +x scripts/backup_fpp_db.sh
   ```

2. Create the backup directory and log file with proper permissions:

   ```bash
   sudo mkdir -p /mnt/hdd/backups
   sudo touch /mnt/hdd/backups/backup.log
   sudo chown -R jkrumm:jkrumm /mnt/hdd/backups
   sudo chmod 644 /mnt/hdd/backups/backup.log
   ```

3. Create and secure the credentials file:
   ```bash
   sudo bash -c 'cat > /root/.fpp-db-credentials << EOL
   DB_HOST=""
   DB_ROOT_PW=""
   EOL'
   ```
4. Secure the credentials file

   ```bash
   sudo chmod 600 /root/.fpp-db-credentials
   sudo chown root:root /root/.fpp-db-credentials
   ```

5. Verify the security of the credentials file:

   ```bash
   # This should show only root can read/write the file
   sudo ls -l /root/.fpp-db-credentials
   # Expected output: -rw------- 1 root root ...

   # This should fail (permission denied) - confirming non-root users can't read it
   cat /root/.fpp-db-credentials
   # Expected output: cat: /root/.fpp-db-credentials: Permission denied
   ```

6. Test the backup script:
   ```bash
   sudo ./scripts/backup_fpp_db.sh
   ```

#### Setting up Automated Backups

1. Edit the root's crontab to set up nightly backups:

   ```bash
   sudo crontab -e
   ```

2. Add the following line to run the backup daily at 2 AM UTC:

   ```bash
   0 2 * * * cd /home/jkrumm/homelab && /home/jkrumm/homelab/scripts/backup_fpp_db.sh >> /mnt/hdd/backups/backup.log 2>&1
   ```

3. Add the following line to run the backup hourly:

   ```bash
   0 * * * * cd /home/jkrumm/homelab && /home/jkrumm/homelab/scripts/backup_fpp_db.sh >> /mnt/hdd/backups/backup.log 2>&1
   ```

#### Backup Details

- Location: Backups are stored in `/mnt/hdd/backups/fpp.sql`
- Frequency: Hourly (every hour at minute 0)
- Logging: All backup operations are logged to `/mnt/hdd/backups/backup.log`
- Retention: Each backup overwrites the previous one (Duplicati handles versioning)
- Security: Credentials are stored in a root-only accessible file
- Monitoring: Backup status is reported to UptimeKuma

#### Monitoring

You can monitor the backup process by:

1. Checking the log file:

   ```bash
   sudo tail -f /mnt/hdd/backups/backup.log
   ```

2. Verifying the backup file exists and is recent:

   ```bash
   ls -l /mnt/hdd/backups/fpp.sql
   ```

3. Checking UptimeKuma dashboard for backup status notifications

The backup file is automatically included in your configured Duplicati backups of the HDD partition.

## Setup HomeLab self healing watchdog

1. The watchdog script is located in the repository at `scripts/homelab_watchdog.sh`. Make it executable:

   ```bash
   chmod +x scripts/homelab_watchdog.sh
   ```

2. Create the log and state directories with proper permissions:

```text
/var/lib/ → stateful
/var/log/ → logs
/var/run/ → lock & pid
```

```bash
# State + Queue
sudo mkdir -p /var/lib/homelab_watchdog
sudo touch /var/lib/homelab_watchdog/state
sudo touch /var/lib/homelab_watchdog/ntfy_queue
sudo chown -R root:root /var/lib/homelab_watchdog
sudo chmod 700 /var/lib/homelab_watchdog

# Log
sudo touch /var/log/homelab_watchdog.log
sudo chown root:root /var/log/homelab_watchdog.log
sudo chmod 644 /var/log/homelab_watchdog.log

# Lockfile wird im Skript selbst erzeugt
# -> kein manuelles Touch nötig, nur Verzeichnis sicherstellen
sudo mkdir -p /var/run
```

3. Create and secure the credentials file:
   ```bash
   sudo bash -c 'cat > /root/.homelab-watchdog-credentials << EOL
   BETTERSTACK_TOKEN=""
   PUSHOVER_USER_KEY=""
   PUSHOVER_API_TOKEN=""
   EOL'
   ```

   **Note:** Fritz!Box credentials are no longer required as the HomeLab is at a remote location and cannot restart the router.
4. Secure the credentials file

   ```bash
   sudo chmod 600 /root/.homelab-watchdog-credentials
   sudo chown root:root /root/.homelab-watchdog-credentials
   ```

5. Verify the security of the credentials file:

   ```bash
   # This should show only root can read/write the file
   sudo ls -l /root/.homelab-watchdog-credentials
   # Expected output: -rw------- 1 root root ...

   # This should fail (permission denied) - confirming non-root users can't read it
   cat /root/.homelab-watchdog-credentials
   # Expected output: cat: /root/.homelab-watchdog-credentials: Permission denied
   ```

6. Test the self-healing script:
   ```bash
   sudo ./scripts/homelab_watchdog.sh
   ```

#### Check current reboot status

```bash
cat /var/lib/homelab_watchdog/reboot_tracker
```

#### Resume automatic recovery (remove manual intervention flag)

```bash
rm /var/lib/homelab_watchdog/manual_intervention_required
```

#### Reset reboot counter (if needed for testing)

```bash
echo "$(date +%Y-%m-%d):0" > /var/lib/homelab_watchdog/reboot_tracker
```

#### Check current escalation state

```bash
cat /var/lib/homelab_watchdog/state
```

#### Setting up Automated Backups

1. Edit the root's crontab to set up nightly backups:

   ```bash
   sudo crontab -e
   ```

2. Add the following line to run the self healing every 10 minutes:

   ```bash
    */10 * * * * /home/jkrumm/homelab/scripts/homelab_watchdog.sh
   ```

#### WatchDog Automation Details

- **Location**: Script runs from `/home/jkrumm/homelab/scripts/homelab_watchdog.sh`
- **Frequency**: Every 10 minutes (configured in crontab)
- **Logging**: All operations are logged to `/var/log/homelab_watchdog.log`
- **Locking**: Built-in file locking prevents overlapping executions
- **State Management**: Persistent state tracking with graduated escalation (0-4)
- **Security**: Credentials stored in root-only accessible file
- **Notifications**: Real-time push notifications via ntfy (`https://ntfy.jkrumm.com/homelab-watchdog`, port 8093 on host)
- **Reboot Protection**: Maximum 3 reboots per day, then requires manual intervention

#### Recovery Strategy

Since the HomeLab is at a remote location (dad's house), the watchdog uses a patient recovery approach:

**Internet Failures:**
- State 0-1: Wait 10 minutes for natural recovery (cannot restart router remotely)
- State 2: Restart network interface
- State 3+: System reboot

**Mount Failures (HDD-specific logic):**
- **HDD not connected:** Sets manual intervention flag, notifies you - NO reboot
- **Encryption not unlocked:** Sets manual intervention flag, notifies you - NO reboot
- **I/O errors detected:** Max 2 escalation attempts, then manual intervention - NO reboot
- **Software mount issue:** Attempts to remount up to 3 times, then escalates normally
- Distinguishes between hardware problems (requires physical access) and software issues
- Uses USB device detection (ORICO VIA Labs adapter) to diagnose connection status

**Smart Failure Detection (Added 2025-11-04):**
- **Retry with exponential backoff:** Before escalating, retries external/internal monitors 3 times (0s, 5s, 10s delays)
- **Pre-recovery verification:** Re-checks all systems before taking action to detect self-resolving issues
- **Docker Compose intelligence:** Distinguishes between actual failures vs containers already running
- Prevents unnecessary recovery actions from transient network hiccups or API timeouts

**External Monitor Checks:**
- Initial check with 3 retries (5s, 10s exponential backoff) before considering failure
- Post-recovery: Waits up to 21 minutes (3 attempts × 7 minutes) for external monitor to update
- Prevents unnecessary recovery actions when services are actually healthy
- Only takes action if BetterStack still reports down after all retries


#### HDD Diagnostic Script

For troubleshooting HDD issues remotely, use the diagnostic script:

```bash
cd ~/homelab
sudo ./scripts/check_hdd.sh
```

The script performs 7 comprehensive checks:
1. **USB Device Detection** - Verifies ORICO USB-SATA adapter is connected
2. **USB Stability** - Checks for connection/disconnection events
3. **Drive Detection** - Confirms the Seagate Exos drive is visible
4. **LUKS Encryption** - Validates encrypted partition exists
5. **Decryption Status** - Checks if partition is unlocked
6. **Mount Status** - Verifies HDD is mounted at `/mnt/hdd`
7. **Write Test** - Confirms drive is writable (no I/O errors)

Each failed step provides specific instructions for your dad to fix the issue on-site (e.g., "Check USB cable", "Reconnect ORICO power supply", etc.).

#### Design Philosophy

The watchdog follows a "better safe than sorry - but verify first" approach:

**Multiple Layers of Validation:**
- **Container existence checks:** Uses `docker ps --filter "name=X" --filter "status=running"` to verify containers are running
- **External HTTP monitoring:** BetterStack checks actual endpoint accessibility from outside
- **Internal service monitoring:** UptimeKuma validates service health from within the network
- **No Docker healthchecks needed:** The combination of external monitors + container running checks provides comprehensive coverage

**Why This Works:**
- External monitors catch "container running but service broken" scenarios
- Container checks catch crashed/stopped containers and Docker daemon issues
- This dual-layer approach is sufficient - adding Docker healthchecks would be redundant overhead
- Well-maintained container images rarely have "running but broken" states

**Smart Recovery Process:**
- **Multiple retries:** Transient network issues (1-2 second hiccups) won't trigger recovery
- **Pre-action verification:** Always re-checks before restarting services
- **Smart diagnosis:** Distinguishes between hardware issues (needs human) vs software issues (can self-heal)
- **Graduated escalation:** Starts with minimal intervention, escalates only if needed

#### Monitoring

You can monitor the backup process by:

1. Checking the log file:

   ```bash
   sudo tail -f /var/log/homelab_watchdog.log
   ```

2. Check current escalation state:

   ```bash
    sudo cat /var/lib/homelab_watchdog/state
   ```

## Setup Calibre and Calibre-Web

### Directory Structure

1. Create the base directory structure:

   ```bash
   # Create main directories
   mkdir -p /home/jkrumm/ssd/SSD/Bücher/{calibre,calibre-web}/{config,library}

   # Create incoming folder for automatic book imports
   mkdir -p /home/jkrumm/ssd/SSD/Bücher/calibre/library/incoming
   ```

2. Final directory layout:

   ```bash
   /home/jkrumm/ssd/SSD/Bücher/
   ├── calibre/
   │   ├── config/     # Calibre configuration
   │   └── library/    # Calibre book library
   │       └── incoming/   # Drop your books here for automatic import
   └── calibre-web/
       └── config/     # Calibre-Web configuration
   ```

3. Directory mappings in containers:
    - Calibre sees:
        - `/config` → `/home/jkrumm/ssd/SSD/Bücher/calibre/config`
        - `/library` → `/home/jkrumm/ssd/SSD/Bücher/calibre/library`
    - Calibre-Web sees:
        - `/config` → `/home/jkrumm/ssd/SSD/Bücher/calibre-web/config`
        - `/books` → `/home/jkrumm/ssd/SSD/Bücher/calibre/library`

### Calibre Setup

1. Access Calibre at `https://calibre.jkrumm.com`
2. Login with:
    - Username: jkrumm
    - Password: Set in `CALIBRE_PASSWORD` environment variable
3. During initial setup:
    - When prompted for library location, set it to: `/library`
    - This maps to `/home/jkrumm/ssd/SSD/Bücher/calibre/library` on your host system
    - Do not use the default `/config/Calibre Library` path
4. Managing Books:
    - Using Auto-Add folder:
        - In Calibre, go to Preferences > Adding books
        - Enable "Automatically add books" and set the folder to `/library/incoming`
        - Now any books you place in `/home/jkrumm/ssd/SSD/Bücher/calibre/library/incoming` will be automatically
          imported
        - Calibre will move the books to the appropriate location in the library after import
    - After adding books:
        - Calibre will automatically fetch metadata
        - You can edit metadata by selecting a book and clicking "Edit metadata"
        - Configure metadata download sources in Preferences > Metadata download
        - Books will be available in both Calibre and Calibre-Web

### Calibre-Web Setup

1. Access Calibre-Web at `https://books.jkrumm.com`
2. Initial setup:
    - Default login: admin/admin123
    - Change the admin password immediately
    - Set library path to: `/books`
    - This will use the same library that you manage with Calibre
3. Configure Calibre Binaries:
    - Go to Admin > Basic Configuration > External Binaries
    - Set "Path to Calibre Binaries" to: `/usr/bin`
    - Save the settings
    - Features enabled by binaries:
        - Ebook format conversion
        - Metadata embedding
        - Email sending with conversion
        - Enhanced cover generation
4. Additional Configuration:
    - Set up user accounts and permissions under Admin > Users
    - Calibre-Web uses the metadata that was fetched by Calibre
    - No additional metadata configuration needed as this is handled by Calibre
5. Test Format Conversion:
    - Select any book
    - Click on "Convert" button
    - Choose a different format
    - If conversion works, the binaries are correctly configured

### Kobo Sync Setup

With Cloudflare tunnels, Kobo sync now works seamlessly as Cloudflare provides IPv4 connectivity while maintaining the IPv6-only home connection.

#### Calibre-Web Configuration

1. Enable Kobo Sync in Admin Settings:

    - Go to Admin > Configuration > Edit Basic Configuration
    - Expand "Feature Configuration"
    - Enable "Kobo sync"
    - Enable "Proxy unknown requests to Kobo Store"
    - Set "Server External Port" to match Calibre-Web's port (8083)

2. Configure User Settings:
    - Go to your user profile
    - Enable "Sync only books in selected shelves with Kobo" (recommended)
    - Create and configure shelves for syncing:
        - Click "Create a Shelf"
        - Name your shelf (e.g., "Fantasy", "Science", etc.)
        - Check "Sync this shelf with Kobo device"
    - Click "Create/View" under "Kobo Sync Token"
    - Copy the generated API endpoint URL

#### Kobo Device Configuration

1. Connect Kobo to Computer:

    - Connect via USB
    - Enable connection on Kobo screen
    - Access Kobo's root directory

2. Edit Configuration File:

   ```bash
   # Navigate to the hidden .kobo folder
   cd .kobo/Kobo/
   # Backup original config
   cp "Kobo eReader.conf" "Kobo eReader.conf.backup"
   # Edit the config file
   vim "Kobo eReader.conf"
   ```

3. Update API Endpoint:

    - Find the [OneStoreServices] section
    - Replace or add the api_endpoint line:

   ```ini
   api_endpoint=https://books.jkrumm.com/kobo/YOURTOKEN
   ```

    - Use the Cloudflare tunnel domain for reliable access
    - Replace YOURTOKEN with your actual token from Calibre-Web

4. Sync Your Device:
    - Safely eject the Kobo
    - On the Kobo home screen, tap the Sync icon
    - First sync may take longer as it builds the database

#### Known Limitations

1. Store Integration:
    - Book covers in Kobo Store may show as generic white pages
    - Overdrive section might have missing covers
    - These are known limitations of the sync implementation

For more detailed information about Kobo sync setup and troubleshooting, refer
to [JC Palmer's comprehensive guide](https://jccpalmer.com/posts/setting-up-kobo-sync-with-calibre-web/).

### Features

- Calibre provides full library management capabilities
- Calibre-Web offers a user-friendly interface for browsing and reading
- Both services share the same library folder
- Automatic updates via Watchtower
- Monitoring via Glance dashboard
- Secure HTTPS access through Cloudflare tunnels
- All configurations and library are backed up via Duplicati

## Setup Immich

[Immich](https://immich.app/) is a self-hosted photo and video backup solution designed to be a Google Photos
alternative.

### Directory Structure

1. Create necessary directories for Immich:

   ```bash
   # Create immich directories
   mkdir -p /home/jkrumm/ssd/SSD/Bilder/immich/{upload,postgres}
   sudo chown -R 1000:1000 /home/jkrumm/ssd/SSD/Bilder/immich
   sudo chmod -R 755 /home/jkrumm/ssd/SSD/Bilder/immich
   ```

### Hardware Acceleration Prerequisites

1. Install required packages for Intel GPU support:

   ```bash
   sudo apt-get update
   sudo apt-get install -y intel-media-va-driver i965-va-driver vainfo
   ```

2. Verify GPU detection:

   ```bash
   vainfo
   ```

   This should show information about your Intel GPU capabilities.

3. Add your user to the required groups:

   ```bash
   sudo usermod -aG video,render jkrumm
   ```

4. Verify device permissions:

   ```bash
   ls -la /dev/dri
   ```

   Make sure the devices are accessible to the video and render groups.

### Initial Setup

1. Make sure the POSTGRES_DB_PASSWORD is set in Doppler

2. **First-time setup or after PostgreSQL upgrade:** Clear the PostgreSQL data directory:

   ```bash
   # Only needed for fresh start or when upgrading PostgreSQL major versions
   sudo rm -rf /home/jkrumm/ssd/SSD/Bilder/immich/postgres/*
   ```

3. Start the Immich services using Docker Compose:

   ```bash
   doppler run -- docker compose up -d immich-server immich-machine-learning immich_redis immich_postgres
   ```

4. Access Immich at `https://immich.jkrumm.com`

5. On first access, you will need to create an admin account:
    - Enter a valid email address
    - Create a secure password
    - Enter your name

### Immich Configuration

1. **Machine Learning:** Go to Administration > Machine Learning:
    - Verify that the machine learning service is connected
    - Enable Smart Search and People Recognition as needed

2. **Hardware Acceleration:** The system is configured with hardware acceleration for better performance:
    - **Video Transcoding:** Uses Intel Quick Sync Video via the integrated GPU
    - **Machine Learning:** Uses OpenVINO for accelerated AI processing
    - To verify hardware acceleration is working, check the Immich admin dashboard

3. **External Library Setup (Read-Only Fuji Photos):**

   The Fuji photos directory (`/home/jkrumm/ssd/SSD/Bilder/Fuji`) is mounted as read-only at `/mnt/media/fuji` inside the container. To configure it:

   **Step 1: Access External Libraries**
   - Log into Immich at `https://immich.jkrumm.com`
   - Click the gear icon (Administration) in the top right
   - In the left sidebar, click **"External Libraries"** (or "Libraries")

   **Step 2: Create External Library**
   - Click **"Create Library"** or **"Create External Library"** button
   - Configure the library:
     - **Owner**: Select your user account
     - **Import Paths**: Enter `/mnt/media/fuji` (use the container path, not the host path)
     - **Exclusion Patterns** (optional): Add patterns to skip unwanted files:
       - `**/.DS_Store` (Mac hidden files)
       - `**/Thumbs.db` (Windows thumbnails)
       - `**/@eaDir/**` (Synology metadata)
   - Click **"Create"**

   **Step 3: Scan the Library**
   - After creation, you'll see a library card for your Fuji library
   - Click the **"Scan Library"** button
   - Wait for the scan to complete (progress shown in UI)
   - Photos will appear in the Photos tab once scanning finishes

   **Important Notes:**
   - External library photos have a folder icon badge in the UI
   - Files are read-only - cannot be modified or deleted from Immich
   - Use Immich's albums, tags, and metadata for organization
   - Enable "Watch for Changes" in library settings for automatic updates when files are added/removed

## Setup ExcaliDash

[ExcaliDash](https://github.com/ZimengXiong/ExcaliDash) is a self-hosted Excalidraw dashboard with persistent storage. It provides a web-based whiteboard for creating diagrams, sketches, and visual documentation with automatic saving.

### Initial Setup

1. Create the data directory:
   ```bash
   mkdir -p /home/jkrumm/ssd/SSD/Dokumente/Anderes/excalidash
   ```

2. Start the containers:
   ```bash
   doppler run -- docker compose up -d excalidash-backend excalidash-frontend
   ```

3. Access ExcaliDash at `https://draw.jkrumm.com`

### Architecture

- **Backend**: Node.js API with SQLite database (Prisma ORM) for storing diagrams
- **Frontend**: Excalidraw-based web UI served via nginx
- **Storage**: SQLite database at `/home/jkrumm/ssd/SSD/Dokumente/Anderes/excalidash/dev.db` (backed up via Duplicati)

### Workflow

1. Create/edit diagrams at `https://draw.jkrumm.com`
2. Diagrams are automatically saved to the SQLite database
3. Export PNG/SVG to `~/ssd/SSD/Public/diagrams/` for embedding
4. Embed in GitHub/Notion/Linear via `https://public.jkrumm.com/diagrams/[file].png`

### Features

- Persistent storage - diagrams saved automatically to SQLite
- Dashboard view for managing multiple diagrams
- Excalidraw editor with full whiteboard capabilities
- Health checks for reliability monitoring
- Automatic updates via Watchtower
- Monitoring via Glance dashboard
- Secure HTTPS access through Cloudflare tunnel

## Setup Public Files (Dufs)

[Dufs](https://github.com/sigoden/dufs) is a lightweight file server for hosting public static files with optional authentication for uploads.

### Directory Setup

1. Create the public files directory:
   ```bash
   mkdir -p /home/jkrumm/ssd/SSD/Public/diagrams
   mkdir -p /home/jkrumm/ssd/SSD/Public/assets
   ```

2. Add the `DUFS_PASSWORD` secret to Doppler

3. Start the container:
   ```bash
   doppler run -- docker compose up -d dufs
   ```

4. Access at `https://public.jkrumm.com`

### Authentication Model

- **Public read**: Anyone can browse directories and download files
- **Authenticated write**: Only `jkrumm` with password can upload, delete, or modify files

To upload files with authentication:
```bash
# Using curl with basic auth
curl -u jkrumm:PASSWORD -T file.png https://public.jkrumm.com/diagrams/project/file.png

# Or use the web interface - click "Upload" and enter credentials when prompted
```

### Usage Examples

Embed images in GitHub READMEs:
```markdown
![Architecture Diagram](https://public.jkrumm.com/diagrams/architecture.png)
```

Embed in Notion/Linear:
- Paste the direct URL: `https://public.jkrumm.com/diagrams/diagram.png`

### Features

- Lightweight file server with directory listing
- Public read access for easy embedding
- Authenticated uploads via HTTP Basic Auth
- Supports drag-and-drop uploads in web interface
- ZIP download for folders
- Search functionality
- Automatic updates via Watchtower
- Files backed up via Duplicati (same SSD backup)

### Configuration Details

The Dufs container is configured with the following optimizations:

| Option | Effect |
|--------|--------|
| `-A` | Allow all operations (public read + directory listing) |
| `--auth jkrumm:$DUFS_PASSWORD@/:rw` | Only authenticated user can write/delete |
| `--enable-cors` | Allows cross-origin requests (required for GitHub/Notion embeds) |
| `--hidden .DS_Store,.git,Thumbs.db` | Hides OS/git clutter from directory listings |

## Setup Obsidian (Always-On)

[LinuxServer Obsidian](https://docs.linuxserver.io/images/docker-obsidian/) runs Obsidian in a Docker container via KasmVNC, providing an always-on instance with plugins that expose HTTP APIs on the Tailscale network.

### Architecture

```
obsidian.jkrumm.com/*           → KasmVNC GUI (HTTP :3000, auth required)
obsidian.jkrumm.com/rest-api/*  → Local REST API plugin (HTTPS :27124, path-stripped)
obsidian.jkrumm.com/tasks-api/* → TaskNotes HTTP API (:8087, path-stripped)
couchdb.jkrumm.com              → CouchDB (Obsidian LiveSync, :5984)
```

Caddy handles path-based routing with `handle_path` (strips prefix before proxying). The Local REST API plugin uses a self-signed cert, so Caddy has `tls_insecure_skip_verify` for that upstream.

### Prerequisites

- CouchDB service already running (see `docker-compose.yml`)
- iGPU drivers installed (shared with Immich)
- `OBSIDIAN_GUI_PASSWORD` and `COUCHDB_PASSWORD` in Doppler

### Initial Setup

1. Create the data directory:
   ```bash
   mkdir -p /home/jkrumm/ssd/obsidian
   ```

2. Start the container:
   ```bash
   doppler run -- docker compose up -d obsidian
   ```

3. Access at `https://obsidian.jkrumm.com` — KasmVNC login (user: `jkrumm`, password from Doppler)

4. Create vault at: Computer → config → vault (maps to `/config/vault`, persisted on SSD)

### Plugin Configuration

#### Obsidian LiveSync

- **CouchDB URI:** `http://couchdb:5984` (internal Docker DNS, no TLS needed)
- **Username:** `jkrumm`
- **Password:** COUCHDB_PASSWORD from Doppler
- **Database:** `obsidian` (auto-created by plugin)

#### Local REST API

- **Bind address:** `0.0.0.0` (required — default `127.0.0.1` blocks Caddy)
- **Port:** `27124` (default)
- **Test:** `curl -k https://obsidian.jkrumm.com/rest-api/`

#### TaskNotes

- **HTTP API port:** `8087`
- **Test:** `curl -k https://obsidian.jkrumm.com/tasks-api/api/health`

### Storage

| Path (host) | Path (container) | Purpose |
|-------------|-----------------|---------|
| `/home/jkrumm/ssd/obsidian` | `/config` | Obsidian data + vault + plugins |
| `/home/jkrumm/ssd/couchdb/data` | `/opt/couchdb/data` | CouchDB database |

### Monitoring

UptimeKuma monitors:
- **Obsidian - Docker:** Container running check
- **Obsidian - HTTP:** KasmVNC GUI (accepts 401 as healthy)
- **Obsidian REST API - HTTP:** Keyword check for `"status":"OK"`
- **Obsidian Tasks API - HTTP:** Keyword check for `"status":"ok"`
- **CouchDB - Docker/HTTP:** Container + `/_up` endpoint