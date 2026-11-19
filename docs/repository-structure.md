# Repository structure and the Argo boundary

Pure infrastructure repo (Docker Compose + ops). The application stack (api + dashboard) lives in [`jkrumm/argo`](https://github.com/jkrumm/argo) on the Mac mini (native LaunchAgent, `make deploy` in that repo; no longer on the VPS since 2026-10-30).

```
homelab/
├── docker-compose.yml       # Service orchestration (infra services)
├── Caddyfile                # Reverse proxy routing (public + private)
├── .env.tpl                 # 1Password secret references (op:// URIs)
├── setup.sh                 # Initial server setup (idempotent)
├── packages/
│   ├── proton-bridge/       # Proton Mail Bridge image (Dockerfile, entrypoint, bridge.pol)
│   └── host-agent/          # Metrics agent image: Dockerfile + ocb manifest copied from the vps repo (docs/host-agent.md)
├── scripts/                 # Operational scripts
│   ├── homelab_watchdog.sh  # Self-healing health monitor (root crontab, every 10 min)
│   └── host-tuning.sh       # Root, idempotent: RAPL package power cap + unattended-upgrades reboot time (`sudo` by hand; setup.sh calls it)
├── config/                  # App configs + extends
│   ├── glance.yml           # Glance dashboard config (single-file :ro mount: `make restart svc=glance` after editing)
│   └── host-agent/          # host.yaml + probe.yaml collector configs (bind-mounted :ro: `make host-agent-deploy` after editing)
├── docs/                    # Detailed documentation
│   ├── backups.md           # Restic design, verification schedules, restore drill
│   ├── s3.md                # VersityGW S3 gateway — bucket map, IAM users, client setup
│   ├── proton-bridge.md     # Proton Bridge image decision, login steps, restore
│   ├── host-agent.md        # Host and container metrics into ClickStack: design, footprint, parity with the retired Beszel alerts
│   ├── decisions.md         # Durable rationale (build-cache, push monitors, Tailscale/Caddy)
│   └── watchdog-behaviors.md
└── uptime-kuma/             # Monitor config-as-code
    ├── sync.py
    └── monitors.yaml
```

**Caddy uses the prebuilt `caddybuilds/caddy-cloudflare` image** — there is no `caddy/`
directory in this repo. `dozzle/` is a root-owned bind mount (`.gitignore`d, holds
`users.yml` + runtime state) that exists only on the server, never checked in.

## Argo (api + dashboard) — separate repo

`jkrumm/argo` runs natively on the Mac mini since 2026-10-30 (LaunchAgent `com.jkrumm.argo` on 127.0.0.1:7737, releases under `~/.argo`, `make deploy` / `make verify` / `make rollback` in the argo repo). It is still served at `https://argo.jkrumm.com` (tailnet-only: the DNS-only A record points at the mini's tailnet IP, the mini's Caddy serves it as an extra FQDN door). The homelab cannot reach that door (the source guard answers 403), so Kuma probes Argo through the mini's Kuma door (`GET /h/argo` on :8795, monitor `Argo - Door` in `uptime-kuma/monitors.mini-door.generated.yaml`); there is no `argo.jkrumm.com` probe from here. The argo API, queried from the mini, reads the homelab over Tailscale:

- `http://${HOMELAB_TAILSCALE_IP}:2376` → docker-socket-proxy-claude (this repo)
- `https://uptime.jkrumm.com` → uptime-kuma (this repo, via socket.io)

See `~/SourceRoot/argo/`. The VPS Argo containers are stopped (rollback kept); the VPS `argo` schema is kept pending an owner decision.
