# Docker operations on the server

**Always use `make` targets instead of raw docker compose commands.** The Makefile wraps every command with `op run --env-file=.env.tpl --` and executes via SSH, so secrets are always injected correctly and you can't accidentally forget the `op` prefix. Run `make help` for the full, live list.

| Command                   | Purpose                                                  |
| ------------------------- | -------------------------------------------------------- |
| `make deploy`             | Full stack deploy: git pull + recreate all services             |
| `make up` / `make down`   | Start/recreate — stop all services                       |
| `make restart svc=<name>` | Force-recreate a single service                          |
| `make ps` / `make logs svc=<name>` / `make logs-follow svc=<name>` | Show running containers — bounded log tail — follow logs live |
| `make proton-bridge-deploy` / `-login` / `-restart` / `-logs` | Proton Mail Bridge (IMAP for hello@, Tailscale-only); `-login` is the one-time interactive CLI — `docs/proton-bridge.md` |
| `make host-agent-deploy` | Build on the server and force-recreate `host-agent` + `host-probe` (metrics agent) after a change to `config/host-agent/` or `packages/host-agent/` — `docs/host-agent.md` |
| `make beszel-alerts` | Converge Beszel alert routing on the hub: title-less ntfy URLs (title names the system), CPU/load alerts to `watchdog`; re-run after adding a CPU/load alert in the Beszel UI — `docs/ntfy.md` |
| `make ntfy-subscribe` | Subscribe the owner's ntfy account to every topic in `config/ntfy/topics.txt` (`TEST=1` sends one message per topic); ntfy-mac follows the account — `docs/ntfy.md` |
| `make docker-df` / `docker-prune` | Disk usage — bounded cleanup (see `docs/decisions.md`) |
| `make caddy-reload`       | Force-recreate Caddy (after Caddyfile changes)           |
| `make uk-sync` / `uk-dry-run` / `uk-export` | Apply / preview / export Uptime Kuma monitors (`uptime-kuma/AGENTS.md`) |
| `make test`               | `uv run tests/test_uptime_kuma_sync_guard.py` + `bash tests/test_setup_cron_replay.sh` + `bash tests/test_pipefail_head.sh` + `bash tests/test_ntfy_topics.sh` — local, no network, no server |
| `make check`              | All local validation: compose config + YAML/shell lint + `make test` (see AGENTS.md → Validate) |
| `make verify`             | Probe production: status page + every active Kuma monitor via Argo — exit 0 = none DOWN (see AGENTS.md → Verify & Monitor) |
| `make version`            | Print the commit sha the server checkout runs (read-only; the software factory's post-deploy check, see `project.yaml`) |

## How secrets work

1. `.env.tpl` contains `op://` references (committed to git — no actual secrets)
2. `OP_SERVICE_ACCOUNT_TOKEN` is set in the server's `~/.profile`; root's cron entry needs its own copy in `/root/.profile` — cron shells source no profile (docs/decisions.md)
3. `op run --env-file=.env.tpl --` resolves all references at runtime and passes them as env vars
4. Docker Compose `environment:` maps these into container env vars

**Locally-built services, build-cache pruning and agentic push-monitor wiring are
documented in `docs/decisions.md`** — durable rationale, kept out of
this file to stay dense.

## Raw commands

```bash
ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- docker compose <command>"
ssh homelab "docker compose ps"          # read-only, no op prefix needed
ssh homelab "docker compose logs -f <service>"
```

## Service dependencies (start order)

```
1. docker-socket-proxy (monitoring services depend on this)
2. caddy (reverse proxy - cloudflared depends on this)
3. All other services
4. cloudflared (depends on caddy + public services - starts last)
```

## Container updates (Watchtower)

- **Opted-out** (manual via `/upgrade-stack`): `karakeep-chrome` + `karakeep-meili` (upstream-pinned tags)
- **Opted-out** (other): `proton-bridge` and `host-agent` + `host-probe` (local builds), `docker-socket-proxy-watchtower`, `dozzle-watchdog-logs` (sidecar), `watchtower` itself
- **Auto-update** (global, daily 06:00, after the 03:30 restic backup and the 05:30 unattended-upgrades reboot): everything else, including `caddy`

