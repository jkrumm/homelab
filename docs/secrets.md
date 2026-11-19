# Secrets: key 1Password paths

## Key Secrets

| 1Password Path                    | Purpose                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `common/cloudflare/DNS_API_TOKEN` | Caddy DNS-01 ACME challenge                             |
| `homelab/cloudflare-tunnel/TOKEN` | Cloudflare tunnel authentication                        |
| `homelab/samba/PASSWORD`          | Samba file share auth                                   |
| `homelab/restic/PASSWORD`         | Restic repo password (NEVER changes after init)         |
| `homelab/restic/HEARTBEAT_URL`    | UptimeKuma push URL for restic backup heartbeat         |
| `common/backblaze-s3/*`           | B2 append-only key — shared by homelab restic + VPS pg-dump (no delete perms) |
| `Private/Backblaze B2/MASTER_*`   | B2 master key — manual use only, `make restic-prune`/`init` from Mac |
| `homelab/versitygw-root/*`        | S3 gateway root key — server-only; creates the IAM users |
| `homelab/s3-admin/*`, `homelab/s3-agent/*` | S3 client keys (MacBook admin / mini agents) — `docs/s3.md` |
| `common/garmin-collector/PUSH_URL`| UptimeKuma push URL — argo's garmin-sync cron pushes after each successful pull from Garmin's Personal API (in `common/` so VPS service account can read) |
| `common/hyperdx/INGEST_KEY` (referenced by item ID in `.env.tpl`: archived duplicates of the same title make `op` refuse the name until they are deleted) | HyperDX/ClickStack OTLP ingestion key (write-only, public by design); `host-agent` and `host-probe` send with it. A copy of `op://vps/argo/HYPERDX_API_KEY_PROD`, which the homelab's service account cannot read; rotation: `docs/host-agent.md` |
| `common/ntfy/{TOKEN,PASSWORD,PASSWORD_HASH}` | ntfy: `tk_` client token (macOS/iOS clients, publishers), admin login, its bcrypt hash — provisioned via env on start (`config/ntfy/server.yml`). Hash is written from the MacBook (service account is read-only). Topics, publishers and priorities: `docs/ntfy.md` (`alerts`: Kuma, watchdog; `updates`: Watchtower, shoutrrr URL in `docker-compose.yml`). |
| `homelab/monitoring/BETTERSTACK_TOKEN`, `homelab/uptime-kuma/PUSH_TOKEN` | Watchdog's own credentials (`op read` at runtime — never a file) |

## Essential commands

```bash
op run --env-file=.env.tpl -- docker compose up -d
op run --env-file=.env.tpl -- env | grep RESTIC
```
