# Uptime Kuma config-as-code

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
  Providers stay UI-managed, except the ones under `settings.ntfy` (the alert
  provider, token from `NTFY_TOKEN`) and `settings.webhooks`: sync.py creates and
  converges those itself, the token read from the named env var.
- **Alerts go to the factory door only; the watchers keep the ntfy page.** A leaf
  carries every provider except `settings.direct_notifications` (`ntfy - Alerts`);
  only the monitors in `settings.watchers` (the factory's and the mini's own
  heartbeats) carry all, so a dead factory still pages. The factory forwards an
  unsolved alert after 30 minutes. sync.py aborts (exit 4) on a watcher that
  matches no monitor; the table in `docs/ntfy.md` is checked against the list by
  `make test`; `make uk-dry-run` shows live drift as `[NOTIFY-DRIFT]`.
- **The monitor name is the identity.** sync.py aborts (exit 5, dry-run too) before any
  write when Kuma already holds two monitors with one name, and re-reads the list right
  before every add, refusing (`[ERROR] ... already exists`, exit 1) one whose name has
  appeared. A slow Kuma acks an add late and a retry doubled four monitors on 2026-11-15
  (the duplicate whose push token no host uses stays DOWN). A duplicate already live: keep
  the one whose token is in the host's `~/.config/uptime-kuma/*-push-url`, delete the
  other (`api.delete_monitor`, `--timeout 240` under load), then re-run.
- **`--extra-config` is repeatable** (merged in order; a missing file is skipped).
  `make uk-sync` passes homelab-private's `monitors.yaml` plus
  `uptime-kuma/monitors.mini-door.generated.yaml` — the mini-door fragment is generated
  by dotfiles (`make kuma-door-gen`), never edited here. Its monitors reach the mini at
  `https://${MINI_TAILSCALE_HOST}:8795/h/<name>` (`.env.tpl` → `homelab/config/MINI_TAILSCALE_HOST`,
  the mini's MagicDNS name; the cert is issued for it, so TLS validates normally).
- **Orphan deletion needs a TTY**, and `make uk-sync` (`ssh` without `-t`) has none —
  it only lists them. To actually delete, run `sync.py --delete-orphans` by hand on
  homelab after a dry-run shows *only* the monitors you mean to drop.
- **`active: false` pauses a monitor**, push monitors included (converged through
  pause/resume; a push monitor without the key keeps its live state). The two
  `WeatherOrb Watchdog` monitors are paused while weatherorb's `ops/V1_FROZEN` exists.
- **`--export` flattens to top-level groups only** — a monitor nested in a subgroup
  never appears in the `.exported` file; read it with `api.get_monitor(<id>)`.
- **Groups never notify; a group flip in Kuma's event list is dashboard-only.** A planned
  redeploy must not page: in-stack HTTP probes (Dozzle, ntfy, Karakeep, S3 Gateway) carry
  `maxretries: 8` (~8 min at the 60 s retry interval). A heartbeat script under `pipefail`
  never pipes into `head -1` (SIGPIPE kills it silently; `tests/test_pipefail_head.sh`).
- **Push monitors use `maxretries: 1`** with `retry_interval` ≤ 3600 (time-to-DOWN is
  `interval + maxretries × retry_interval`); the exceptions are `Software Factory - Push`
  (0) and `Home Line - Watchdog` (2), commented in `monitors.yaml`. Wiring a brand-new
  push monitor end to end is fully agentic; see `docs/decisions.md`.
