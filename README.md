# Homelab Setup Guide

Infrastructure-as-code for two machines: a HomeLab server (Ubuntu 24.04, physical
box at a remote location) and the VPS (Hetzner ARM64, separate repo at
`~/SourceRoot/vps`). Docker Compose + Caddy + Cloudflare Tunnel + Tailscale, self-healing
via a cron watchdog, monitored with Uptime Kuma (config-as-code) and backed up nightly
to Backblaze B2 via restic.

**For agent-facing operating rules, gotchas and the full command reference, see
`CLAUDE.md`.** This file is onboarding: what runs where, how to reach it, and how to set
a fresh server up from scratch.

---

## Table of Contents

1. [Infrastructure Overview](#infrastructure-overview)
2. [Service Access](#service-access)
3. [Security Hardening](#security-hardening)
4. [Documentation](#documentation)
5. [1Password Secrets](#1password-secrets)
6. [Setup Guide](#setup-guide)
7. [Reusing an Existing Encrypted HDD](#reusing-an-existing-encrypted-hdd)
8. [Mount the TRANSFER Partition](#mount-the-transfer-partition)
9. [File Access](#file-access)
10. [Setup Beszel](#setup-beszel)
11. [Setup Dozzle](#setup-dozzle)
12. [Setup UptimeKuma](#setup-uptimekuma)
13. [Setup Restic Backup](#setup-restic-backup)
14. [Setup HomeLab self-healing watchdog](#setup-homelab-self-healing-watchdog)
15. [Setup Immich](#setup-immich)
16. [Setup Public Files (Dufs)](#setup-public-files-dufs)

---

## Infrastructure Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        HomeLab (Ubuntu 24.04)                        │
│  Public:   Internet → Cloudflare CDN → CF Tunnel → caddy:80 → app    │
│  Private:  Tailscale device → caddy:443 (HTTPS, Let's Encrypt) → app │
│  25 containers · Storage: internal SSD + encrypted external HDD      │
│  Watchdog: self-healing monitor (root cron, every 10 min)            │
├──────────────────────────────────────────────────────────────────────┤
│                   VPS (Hetzner ARM64, Ubuntu 22.04)                  │
│  Public:   Internet → Cloudflare CDN → CF Tunnel → caddy:80 → app    │
│  MariaDB:  Vercel → port 33306 (direct, Hetzner FW allows)           │
│  Argo, FPP, BunEmailApi, Umami, HyperDX, MariaDB, … — see ~/vps      │
├──────────────────────────────────────────────────────────────────────┤
│                        Cross-Machine Links                           │
│  Dozzle hub (HomeLab) ←→ Dozzle agent (VPS)  via Tailscale           │
│  Beszel hub (HomeLab) ←→ Beszel agent (VPS)  via Tailscale           │
└──────────────────────────────────────────────────────────────────────┘
```

## Service Access

#### HomeLab — Public (Cloudflare Tunnel → Caddy → container)

| Service     | URL                                                | Purpose            |
| ----------- | --------------------------------------------------- | ------------------- |
| Glance      | [glance.jkrumm.com](https://glance.jkrumm.com)       | Home dashboard      |
| Immich      | [immich.jkrumm.com](https://immich.jkrumm.com)       | Photo management    |
| UptimeKuma  | [uptime.jkrumm.com](https://uptime.jkrumm.com)       | Status page         |
| Dufs        | [public.jkrumm.com](https://public.jkrumm.com)       | Public file server  |
| Image Share | [share.jkrumm.com](https://share.jkrumm.com)         | Personal photo library — public share links (bare `/<slug>` → `/s/<slug>`), admin UI under `/admin`, API under `/api` |

#### HomeLab — Private (Tailscale devices only, via Caddy HTTPS `:443`)

| Service          | URL                                              | Purpose                                                       |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Beszel           | [beszel.jkrumm.com](https://beszel.jkrumm.com)   | System metrics                                                |
| Dozzle           | [dozzle.jkrumm.com](https://dozzle.jkrumm.com)   | Container logs                                                |
| FileBrowser      | [files.jkrumm.com](https://files.jkrumm.com)     | File management                                               |
| Garmin Collector | [garmin.jkrumm.com](https://garmin.jkrumm.com)   | Stateless Garmin Connect HTTP layer (called by argo from VPS) |
| Karakeep         | [karakeep.jkrumm.com](https://karakeep.jkrumm.com) | Read-later / bookmark bucket, AI auto-tagging via IU endpoint |

DNS: grey cloud (DNS-only) A records pointing to the HomeLab Tailscale IP —
unreachable from the public internet. TLS via Let's Encrypt (Cloudflare DNS-01
challenge). Full network topology and the Caddy dual-http/https detail:
`CLAUDE.md` → Network Topology.

#### HomeLab — Internal (no direct web access)

Caddy, Cloudflared, three docker-socket-proxy variants (monitoring / Watchtower / argo),
Watchtower, Samba, Beszel Agent, Immich ML/Postgres/Redis, Restic Backup (daily 03:30
cron), watchdog log sidecars. See `CLAUDE.md` → Repository Structure for the full
compose service list.

#### VPS — Public (monitored from here, full inventory + ops in `~/SourceRoot/vps`)

Argo (`argo.jkrumm.com`, Tailscale-only), Free Planning Poker
(`free-planning-poker.com` + `server.`/`analytics.` subdomains), Photos
(`photos.jkrumm.com`), BunEmailApi, RollHook, HyperDX (Tailscale-only), Umami.

#### Tailscale devices

`ssh homelab` / `ssh vps` (aliases resolve via `~/.ssh/config`, Tailscale mesh,
tailnet `dinosaur-sole.ts.net`). Device IPs are placeholders in every tracked file —
read the real ones from `tailscale status` or the admin console.

---

## Security Hardening

Both machines are hardened with identical configurations (applied via `setup.sh`):

| Component               | Configuration                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SSH**                 | Drop-in at `/etc/ssh/sshd_config.d/99-hardening.conf`: PermitRootLogin no, PasswordAuthentication no, MaxAuthTries 3, X11/Agent/TcpForwarding disabled |
| **UFW**                 | Default deny incoming. SSH restricted to Tailscale CGNAT range (`100.64.0.0/10`). HomeLab: Samba also Tailscale-only. VPS: HTTPS + MariaDB open        |
| **fail2ban**            | Enabled (sshd jail)                                                                                                                                    |
| **sysctl**              | kptr_restrict=2, dmesg_restrict=1, ptrace_scope=2, rp_filter=1, log_martians=1, send_redirects=0, unprivileged_bpf_disabled=1                          |
| **unattended-upgrades** | Security updates auto-installed. Docker packages blacklisted. Auto-reboot at 4 AM if kernel update pending                                             |
| **Docker**              | `no-new-privileges:true` on all containers (except host-network agents). Memory limits on resource-heavy services. JSON log rotation                   |
| **Hetzner FW**          | VPS only: 2 rules — HTTPS (443) + MariaDB (33306). SSH removed (Tailscale-only access)                                                                 |

**Emergency access:** HomeLab — physical access at remote location. VPS — Hetzner web console (no SSH needed).

---

## Documentation

| Document                     | Purpose                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `docs/backups.md`            | Restic → B2 design, retention, two-key model, Mac-side restore drill               |
| `docs/decisions.md`          | Durable rationale: build-cache pruning, agentic push-monitor wiring, Garmin MFA automation, Tailscale/Caddy insights |
| `docs/watchdog-behaviors.md` | Failure scenarios, escalation states, recovery paths for the self-healing watchdog  |

Run the `/docs` skill after infrastructure changes — it keeps each fact owned by exactly
one of README / CLAUDE.md / `docs/*.md`.

---

## 1Password Secrets

`.env.tpl` (repo root) is the full, current list of `op://` references this stack needs —
read it rather than a hand-maintained copy here. The dense reference table (which secret
does what) lives in `CLAUDE.md` → Key Secrets. To set up a fresh vault:

```bash
op vault list
op item list --vault homelab
op item list --vault common
```

## Setup Guide

### Install Ubuntu Server

Flash the [Ubuntu Server ISO](https://ubuntu.com/download/server) with
[Rufus](https://rufus.ie/)/[Balena Etcher](https://www.balena.io/etcher/), boot from it,
and install with: hostname `homelab`, username `jkrumm`, LVM across the whole disk,
OpenSSH server + standard utilities, automatic security updates. Reboot, log in, then:

```bash
sudo apt update && sudo apt upgrade -y
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

5. Adjust your public SSH key in the `setup.sh` script.
6. Run the setup script with sudo:

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
2. The tunnel token is stored in 1Password (`homelab/cloudflare-tunnel/TOKEN`)
3. The docker-compose.yml includes the cloudflared service which will automatically connect using the token

### Configure 1Password CLI

1. Install 1Password CLI (`op`) — see `setup.sh` for automated installation
2. Set the service account token:

   ```bash
   # Add to ~/.bashrc
   export OP_SERVICE_ACCOUNT_TOKEN="<token>"
   ```

3. Verify access:

   ```bash
   op vault list
   op item list --vault homelab
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

Paste the keyfile content into the file. Secure the keyfile:

```bash
sudo chmod 600 /root/.hdd-keyfile
```

#### Identify the Encrypted Partition

```bash
sudo blkid
```

Note the UUID of the LUKS-encrypted partition (e.g., `/dev/sdb2`).

#### Configure `/etc/crypttab`

```bash
sudo vim /etc/crypttab
```

Add the following line, replacing `<UUID>` with the UUID from the previous step:

```bash
encrypted_partition UUID=<UUID> /root/.hdd-keyfile luks
```

#### Configure `/etc/fstab`

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

### Mount automatically with a systemd service (belt-and-suspenders)

crypttab/fstab alone don't guarantee `/mnt/hdd` is mounted *before* `docker.service`
starts. Add an explicit ordering unit:

```bash
sudo tee /usr/local/bin/mount_hdd.sh <<'EOF'
#!/bin/bash
if ! mount | grep -q '/mnt/hdd'; then
    mount /dev/mapper/encrypted_partition /mnt/hdd
fi
EOF
sudo chmod +x /usr/local/bin/mount_hdd.sh

sudo tee /etc/systemd/system/mount-hdd.service <<'EOF'
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
EOF

sudo systemctl enable mount-hdd.service
sudo reboot   # then: mount | grep /mnt/hdd
```

## Mount the `TRANSFER` Partition

1. Create the mount point:

   ```bash
   sudo mkdir -p /mnt/transfer
   ```

2. Edit `/etc/fstab` to mount the `TRANSFER` partition at boot. Replace `6785-1A1C` with the UUID of your `TRANSFER` partition if it's different:

   ```bash
   UUID=6785-1A1C /mnt/transfer exfat defaults,uid=1000,gid=1000 0 0
   ```

3. Mount immediately without rebooting:

   ```bash
   sudo mount /mnt/transfer
   ```

4. Verify:

   ```bash
   df -h | grep transfer
   ```

5. Set permissions (optional):

   ```bash
   sudo chown -R 1000:1000 /mnt/transfer
   sudo chmod -R 755 /mnt/transfer
   ```

## File Access

Files on the SSD (`/mnt/ssd/SSD`) and HDD (`/mnt/hdd`) are reachable two ways.

### Filebrowser (Web Interface)

1. Create the filebrowser directory with correct permissions:

   ```bash
   sudo mkdir -p /mnt/hdd/filebrowser
   sudo chown -R 1000:1000 /mnt/hdd/filebrowser
   sudo chmod -R 755 /mnt/hdd/filebrowser
   ```

2. Start the container:

   ```bash
   op run --env-file=.env.tpl -- docker compose up -d filebrowser
   ```

   Filebrowser will automatically create `filebrowser.db` and `settings.json` in `/mnt/hdd/filebrowser/`.

3. Access at `https://files.jkrumm.com` — default login `admin`/`admin`, change immediately.

### Samba (SMB File Sharing)

SMB3-only (blocks SMB1/SMB2), encryption preferred, macOS-compatible (fruit VFS module).

1. Create a specific SSD folder for Samba:

   ```bash
   sudo mkdir -p /home/jkrumm/ssd
   sudo chown -R 1000:1000 /mnt/ssd/samba
   sudo chmod -R 755 /mnt/ssd/samba
   ```

2. Access (Tailscale devices only):
   - **Direct** (preferred): Finder → `Cmd+K` → `smb://samba.jkrumm.com`
   - **SSH tunnel** (fallback): `ssh -L 1445:localhost:445 homelab` → `smb://localhost:1445`
   - Username: jkrumm, password in 1Password
   - Samba ports (139, 445) restricted to Tailscale CGNAT range via UFW

**Filebrowser** is best for web-based upload/browse; **Samba** for mounting network drives and bulk operations.

## Setup Beszel

1. Create a specific folder for Beszel data on the HDD:
   ```bash
   sudo mkdir -p /mnt/hdd/beszel
   sudo chown -R 1000:1000 /mnt/hdd/beszel
   chmod 755 /mnt/hdd/beszel
   ```
2. Access at `https://beszel.jkrumm.com` — username jkrumm, password in 1Password.

## Setup Dozzle

### Setup certificates

1. Download cert.pem and key.pem from 1Password HomeLab
2. Rsync them to the HomeLab and the VPS: `rsync -avz cert.pem key.pem jkrumm@<vps-tailscale-host>:/home/jkrumm/homelab`
3. Validate by checking the container logs

### Dozzle Authentication Setup

1. Create the Dozzle data directory: `mkdir dozzle` (root-owned bind mount, gitignored)
2. Generate the password hash and create `users.yml`:

   ```bash
   docker run amir20/dozzle generate --name "Johannes Krumm" --email your@email.com --password your_password jkrumm
   vim dozzle/users.yml   # paste the generated output
   ```

3. `docker-compose.yml` already has simple auth enabled, a 48-hour login session, and the `users.yml` volume mount.
4. Restart: `docker compose up -d dozzle`. Access at `https://dozzle.jkrumm.com` (username `jkrumm`).

### Viewing System Logs in Dozzle

Dozzle only sees container logs. To stream a plain log file, add an Alpine sidecar that
tails it — the container shows up in Dozzle. Currently monitored this way: HomeLab
Watchdog (`homelab-watchdog-logs` → `/var/log/homelab_watchdog.log`).

```yaml
dozzle-your-log:
  container_name: your-log-name
  image: alpine
  volumes:
    - /path/to/your.log:/var/log/stream.log
  command: [tail, -f, /var/log/stream.log]
  network_mode: none
  restart: unless-stopped
  labels:
    glance.hide: true
```

Then `op run --env-file=.env.tpl -- docker compose up -d`.

## Setup UptimeKuma

1. Create the data folder on the SSD:

   ```bash
   sudo mkdir -p /home/jkrumm/ssd/uptime-kuma
   sudo chown -R 1000:1000 /home/jkrumm/ssd/uptime-kuma
   chmod -R 755 /home/jkrumm/ssd/uptime-kuma
   ```

   **Why SSD, not HDD?** UptimeKuma uses SQLite with Write-Ahead Logging. With
   multiple monitors checking every 60-250s, HDD seek times cause database lock
   timeouts and false-positive failures; SSD cuts write latency 10-100x.

2. **Version:** `louislam/uptime-kuma:2` (stable 2.x). Watchtower handles auto-updates.
3. Config: `SQLITE_BUSY_TIMEOUT=30000`, `DOCKER_HOST=tcp://docker-socket-proxy:2375`,
   memory limit 1G/512M reserved. **Docker monitors:** add via UI as TCP connection
   type, URL `tcp://docker-socket-proxy:2375` — never a direct socket mount.
4. **Cloudflare WAF bypass** for monitors hitting VPS services through the tunnel:
   header `X-Uptime-Monitor` with a secret value (1Password → HomeLab), matched by a
   Cloudflare WAF custom rule to skip bot protection.
5. **Migrating from HDD?**
   ```bash
   docker compose stop uptime-kuma
   sudo rsync -av /mnt/hdd/uptimekuma/ /home/jkrumm/ssd/uptime-kuma/
   sudo chown -R 1000:1000 /home/jkrumm/ssd/uptime-kuma
   op run --env-file=.env.tpl -- docker compose up -d uptime-kuma
   ```
6. **Database maintenance (optional):**
   ```bash
   docker compose stop uptime-kuma
   sqlite3 /home/jkrumm/ssd/uptime-kuma/kuma.db "PRAGMA optimize;"
   sqlite3 /home/jkrumm/ssd/uptime-kuma/kuma.db "VACUUM;"
   op run --env-file=.env.tpl -- docker compose up -d uptime-kuma
   ```
7. **Diagnostics:** `docker logs uptime-kuma -f | grep -iE "(warn|error)"`
8. **Config as code:** monitors live in `uptime-kuma/monitors.yaml`, synced via
   `sync.py` — commands and gotchas are in `CLAUDE.md` → Uptime Kuma Config-as-Code
   (single copy, don't duplicate here). Required secret: `homelab/uptime-kuma/PASSWORD`.

   First-time venv setup:
   ```bash
   cd ~/homelab
   python3 -m venv uptime-kuma/.venv
   uptime-kuma/.venv/bin/pip install -r uptime-kuma/requirements.txt
   ```

## Setup Restic Backup

`restic-backup` (`mazzolino/restic`) runs daily at 03:30 local and pushes
content-addressed encrypted snapshots of `/sources/*` to Backblaze B2. Full design
(sources, retention, two-key model, restore drill): **`docs/backups.md`**.

```bash
make restic-snapshots   # list snapshots in B2
make restic-stats       # repo size + dedup stats
make restic-check       # metadata integrity (no data download)
make restic-run         # trigger an unscheduled backup
make restic-logs        # follow container logs
make restic-prune       # quarterly, from your Mac, uses the master B2 key
```

## Setup HomeLab self-healing watchdog

1. Make the script executable:

   ```bash
   chmod +x scripts/homelab_watchdog.sh
   ```

2. Create the log and state directories:

   ```bash
   # State + queue
   sudo mkdir -p /var/lib/homelab_watchdog
   sudo touch /var/lib/homelab_watchdog/state /var/lib/homelab_watchdog/notification_queue
   sudo chown -R root:root /var/lib/homelab_watchdog
   sudo chmod 700 /var/lib/homelab_watchdog

   # Log
   sudo touch /var/log/homelab_watchdog.log
   sudo chown root:root /var/log/homelab_watchdog.log
   sudo chmod 644 /var/log/homelab_watchdog.log

   # Lockfile is created by the script itself — just ensure the directory exists
   sudo mkdir -p /var/run
   ```

3. **Credentials:** the script reads `BETTERSTACK_TOKEN`, `common/slack/WEBHOOK_ALERTS`
   and `homelab/uptime-kuma/PUSH_TOKEN` live via `op read` under root's
   `OP_SERVICE_ACCOUNT_TOKEN` session — there is no credentials file to create.
   Verify root can reach 1Password:

   ```bash
   sudo -i
   op whoami
   ```

4. Test the self-healing script:
   ```bash
   sudo ./scripts/homelab_watchdog.sh
   ```

### Install the cron job

The watchdog runs from **root's crontab** (not `jkrumm`'s, not `/etc/cron.d`, not a
systemd timer):

```bash
sudo crontab -e
# add:
*/10 * * * * . /root/.profile; /home/jkrumm/homelab/scripts/homelab_watchdog.sh
```

Root, because the script restarts containers, remounts the HDD and can reboot;
`.profile` first so it sees the same PATH as an interactive root shell. Verify it's
firing without sudo — cron logs each run to the journal:

```bash
ssh homelab "journalctl -u cron --since '30 min ago' --no-pager | grep homelab_watchdog"
ssh homelab "tail -3 /var/log/homelab_watchdog.log"
```

### Quick reference

```bash
cat /var/lib/homelab_watchdog/reboot_tracker              # daily reboot count
cat /var/lib/homelab_watchdog/state                       # escalation level (0-4)
rm /var/lib/homelab_watchdog/manual_intervention_required  # resume auto-recovery (usually auto-clears)
tail -f /var/log/homelab_watchdog.log                      # follow logs
```

Failure scenarios, escalation states, and recovery design: **`docs/watchdog-behaviors.md`**.

## Setup Immich

[Immich](https://immich.app/) is a self-hosted photo and video backup solution.

### Directory Structure

```bash
mkdir -p /home/jkrumm/ssd/SSD/Bilder/immich/{upload,postgres}
sudo chown -R 1000:1000 /home/jkrumm/ssd/SSD/Bilder/immich
sudo chmod -R 755 /home/jkrumm/ssd/SSD/Bilder/immich
```

### Hardware Acceleration

**Not active** on this server. `config/hwaccel.ml.yml` and `config/hwaccel.transcoding.yml`
are stubs — required by the `extends:` directives in `docker-compose.yml` but provide no
device mounts. Immich runs CPU-mode inference and transcoding. To enable, replace the
stubs with device config from the [official Immich hwaccel docs](https://immich.app/docs/features/ml-hardware-acceleration).

### Initial Setup

1. Ensure `POSTGRES_DB_PASSWORD` is set in 1Password (`homelab/postgres/PASSWORD`).
2. **First-time or after a PostgreSQL major upgrade:** clear the data directory:
   ```bash
   sudo rm -rf /home/jkrumm/ssd/SSD/Bilder/immich/postgres/*
   ```
3. Start the services:
   ```bash
   op run --env-file=.env.tpl -- docker compose up -d immich-server immich-machine-learning immich_redis immich_postgres
   ```
4. Access at `https://immich.jkrumm.com`, create the admin account on first visit.

### Configuration

- **Machine Learning:** Administration → Machine Learning — verify the ML service is
  connected, enable Smart Search / People Recognition as needed.
- **External Library (read-only Fuji photos):** `/home/jkrumm/ssd/SSD/Bilder/Fuji` is
  mounted read-only at `/mnt/media/fuji`. Administration → External Libraries → Create
  Library, import path `/mnt/media/fuji` (container path, not host path), then Scan.
  External-library photos carry a folder-icon badge and can't be modified from Immich.
- **Restore / rollback / DB backup mechanics:** `docs/backups.md` → Immich database.

## Setup Public Files (Dufs)

[Dufs](https://github.com/sigoden/dufs) is a lightweight file server for hosting public static files with optional authentication for uploads.

1. Create the directories:
   ```bash
   mkdir -p /home/jkrumm/ssd/SSD/Public/diagrams
   mkdir -p /home/jkrumm/ssd/SSD/Public/assets
   ```
2. Add the `DUFS_PASSWORD` secret to 1Password (`homelab/dufs/PASSWORD`).
3. Start the container: `op run --env-file=.env.tpl -- docker compose up -d dufs`
4. Access at `https://public.jkrumm.com`.

**Authentication model:** public read (anyone can browse/download); authenticated write
(only `jkrumm` can upload/delete/modify).

```bash
# Upload with basic auth
curl -u jkrumm:PASSWORD -T file.png https://public.jkrumm.com/diagrams/project/file.png
```

Embed in READMEs/Notion/Linear with the direct URL, e.g.
`![Architecture Diagram](https://public.jkrumm.com/diagrams/architecture.png)`.

| Option                              | Effect                                                           |
| ------------------------------------ | ------------------------------------------------------------------ |
| `-A`                                | Allow all operations (public read + directory listing)           |
| `--auth jkrumm:$DUFS_PASSWORD@/:rw` | Only authenticated user can write/delete                         |
| `--enable-cors`                     | Allows cross-origin requests (required for GitHub/Notion embeds) |
| `--hidden .DS_Store,.git,Thumbs.db` | Hides OS/git clutter from directory listings                     |

Files backed up via restic (`Public` source); auto-updated via Watchtower.
