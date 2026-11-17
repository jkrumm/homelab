# Homelab - Ubuntu Server Management

Infrastructure as Code (Docker Compose) for an Ubuntu 24.04 server at a remote house: physical
access is limited, so a reboot or a lost mount is not recoverable from here. Edit locally, push to
GitHub, deploy over SSH through the Makefile. Public services go Cloudflare tunnel → Caddy,
private ones Tailscale → Caddy. The VPS stack lives in `~/SourceRoot/vps`; the REST API and
dashboard live in [`jkrumm/argo`](https://github.com/jkrumm/argo) on the Mac mini.

Skills: `/audit` (health audit and repair), `/cloudflare` (DNS and tunnel ingress), `/docs`
(one owning doc per fact; run it before committing a change to infrastructure or scripts),
`/upgrade-stack <name>` (manually managed containers), `/commit`.

## Repository boundary: homelab vs homelab-private

This repo is public; `~/SourceRoot/homelab-private/` is a separate private repo on the same server
(VPN-routed torrent and media stack). Do not describe its containers as part of this stack in
service tables, compose files or the README: say "the homelab-private stack". Allowed
cross-references: `.env.tpl` API tokens for services homelab tools consume (Glance widgets),
glob excludes in `restic-excludes.txt`, and the watchdog's call to its `vpn-cycle.sh`. Any
other mention stays out. The Tailscale ACL is not here: `dotfiles` make targets
(`make tailscale-acl-{diff,pull,push}`, MacBook only), source `dotfiles-private/tailscale-acl.jsonc`.

## Server access

`ssh homelab` and `ssh vps` go over Tailscale, the only path in (UFW and the Hetzner firewall
block direct SSH; emergency access is physical or the Hetzner console). Use `ssh -t` when a
command follows a stream. Files: Samba (`smb://samba.jkrumm.com`) for people, S3
(`https://s3.jkrumm.com`, `docs/s3.md`) for agents, never an SMB mount.

The box has 4 slow cores (N100 under a RAPL cap) and also serves ntfy, Uptime Kuma, Beszel,
cloudflared and Tailscale: a batch job that holds every core takes alerting down (load 20-37 and
Kuma pushes answering 530/502 on 2026-11-14). For any job started from an SSH session:

- One batch job at a time, at most 3 workers (`--workers 3`, `xargs -P3`). `ssh homelab uptime`
  above load 4: wait.
- Run it detached: `nohup nice -n 19 <cmd> > ~/job.log 2>&1 &`, then poll the log.
- Never move bulk data through `ssh homelab` (tailscaled costs ~0.3 core per 0.5 MB/s): use S3 or SMB.
- A build started over SSH uses the `lowprio` buildx builder (`docker buildx ls` shows `lowprio*`),
  never `--builder default`.
- A workload from another repo ("guest") stays within 1.5 cores in total, 1 core each, 3 worker
  processes, and declares `cpus: <= 1` in its compose file.

Before sizing or placing any such workload, Read `docs/ssh-and-batch.md` (the full rules, the CPU
budget table, the gate, what each cap enforces, why).

## Secrets

Vaults `common` (cross-server) and `homelab`. `.env.tpl` is committed and holds only `op://`
references; commands run as `op run --env-file=.env.tpl -- <command>`, which the Makefile does for
you. Never commit, log or echo a secret value; `OP_SERVICE_ACCOUNT_TOKEN` is the only secret on
disk. Which path holds what: `docs/secrets.md`.

## Docker operations

Server operations go through `make` targets, never raw `docker compose` on the server: every target
wraps `op run` and SSH, and a raw call can miss a secret. Common: `make deploy`, `make up`/`down`,
`make restart svc=<name>`, `make logs svc=<name>`, `make caddy-reload` (after Caddyfile edits),
`make uk-sync`/`uk-dry-run`; `make help` lists all. `make deploy`, `up` and `restart` refuse while
a restic process runs (`FORCE=1` overrides): a recreate kills a running backup. The start order
(socket proxy first, cloudflared last), the Watchtower opt-outs, the full target table and the
secret flow: `docs/docker-operations.md`. Build cache and push-monitor rationale: `docs/decisions.md`.

## Network and storage

Caddy is the single routing layer; the `Caddyfile` is the source of truth. Each site block needs both
an `https://` (Tailscale) and an `http://` (cloudflared) variant, or the public route breaks. Device
IPs are placeholders in every tracked file: resolve them with `tailscale status`. Monitoring services
reach Docker only through `docker-socket-proxy` (read-only). Details, networks and the socket-proxy
exceptions: `docs/network.md`. Storage: `/home/jkrumm/ssd` (SSD) and `/mnt/hdd` (encrypted
external HDD, nofail so a missing drive does not block boot); the map of mounts and directories is
`docs/storage-layout.md`; where personal data lives is `dotfiles/docs/storage.md`.

## Backups

Restic to Backblaze B2, daily 03:30, two-key ransomware-safe pattern, with weekly `restic check`,
half-monthly read-back and restore drill, each with a Kuma push monitor. The WeatherOrb archive on
`/mnt/hdd/weatherorb-archive` is outside restic and is the only copy. Design, operations and restore
commands: `docs/backups.md`.

## Repository structure

Pure infrastructure repo; docs sit in `docs/`. Before changing anything under `uptime-kuma/`, Read
`uptime-kuma/AGENTS.md` (sync.py must run on the server; monitor names are identities; the notification
model). The directory map and the Argo boundary (what argo reads from here over Tailscale):
`docs/repository-structure.md`.

## Watchdog and self-healing

`scripts/homelab_watchdog.sh` runs every 10 minutes from root's crontab, not `jkrumm`'s, not
`/etc/cron.d`, not a systemd timer: it restarts containers, remounts the HDD and can reboot, and
root's `/root/.profile` supplies its `OP_SERVICE_ACCOUNT_TOKEN` (the `[ -r ]` guard is load-bearing).
It auto-clears `manual_intervention_required` once checks pass; only unrecoverable states stay stuck
(`ssh homelab "sudo rm /var/lib/homelab_watchdog/manual_intervention_required"`). Read
`docs/watchdog-behaviors.md` before touching it or its credentials.

## Validate

`make check` runs locally with no server, secrets or Docker mutation: compose config, YAML and shell
lint, and `make test` (regression suites). A non-zero exit means the change is not ready.

## Deploy

Manual and push-driven: commit and push, then `make deploy` (full stack), `make proton-bridge-deploy`
or `make caddy-reload`; each `git pull`s on the server and applies with secrets from `op run`.

## Verify & Monitor

- **Health URL:** `https://uptime.jkrumm.com/status/homelab-watchdog`; machine-readable
  `https://uptime.jkrumm.com/api/status-page/heartbeat/homelab-watchdog` (`heartbeatList`: monitor id
  to beats, `status` 0 DOWN, 1 UP, 2 PENDING, 3 MAINTENANCE). Healthy means the last beat of every
  listed monitor is UP (3 is fine); incidents and maintenance windows are informational only.
- **Kuma monitor:** `HomeLab Watchdog - Push`.
- **OTel `service.name`:** `host-agent` (host metrics) and `host-probe` (container metrics), `host.name=homelab`, sent
  to ClickStack on the VPS (`docs/host-agent.md`: two containers, key, queue, footprint, Beszel parity). No receiver runs here.
- `make verify` (needs `jq`) checks the status page, then `scripts/verify-monitors.sh` checks every
  active non-group monitor through Argo on the mini (`127.0.0.1:7737/api/uptime-kuma/monitors`,
  bearer `op://common/api/SECRET` via `secrets-run`). Any DOWN fails; PENDING is a `NOTE:`. It runs
  only where Argo is (the mini): an unreachable Argo is UNHEALTHY, not skipped.

## Gotchas

- `uptime-kuma/sync.py` runs on the homelab server only (`localhost:3010`); orphan deletion needs a TTY.
- Never hardcode tailnet IPs, hosts or secrets in tracked files: placeholders only.
- A missing service: `docker logs cloudflared`; a crash loop: `docker logs --tail=100 <container>`;
  HDD not mounted: `sudo cryptsetup status encrypted_partition && mount | grep hdd`.
- Memory limit: Uptime Kuma 1G (512M reserved); container logs rotate at 10m x 2.

## Agent behavior

- Ask before reboots, volume or data deletion (`docker compose down -v`, anything on `/mnt/hdd`),
  encrypted HDD mount changes and Cloudflare tunnel changes.
- Apply changes one service at a time and check its health after each.
- Do not modify watchdog credentials without `docs/watchdog-behaviors.md`.
- README.md holds setup and the service table; this file does not.
