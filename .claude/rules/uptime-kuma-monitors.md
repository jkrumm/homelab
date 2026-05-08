---
paths:
  - uptime-kuma/monitors.yaml
  - ../homelab-private/uptime-kuma/monitors.yaml
---

# Uptime Kuma Monitor Naming Convention

Every leaf monitor name MUST end with a ` - <Type>` suffix. The last ` - ` (space-dash-space) separates the human-readable subject from the monitor's type.

## Pattern

```
<Subject> - <Type>
```

- **Subject** — what is being monitored. May contain ` - ` for namespacing (e.g., `FPP - DB`).
- **Type** — the *last* token, identifies how the check is performed. Always one of the values below.

## Allowed type suffixes

| Suffix     | Underlying `type:`           | Use for                                                                |
|------------|------------------------------|------------------------------------------------------------------------|
| `Docker`   | `docker`                     | Docker container health probes                                         |
| `HTTP`     | `http` *or* `keyword`        | Any HTTP/HTTPS endpoint check (incl. keyword-validation responses)     |
| `Push`     | `push`                       | Heartbeat / push monitors fed by external scripts                      |
| `Uptime`   | `http` (BetterStack API URL) | External uptime probes against `uptime.betterstack.com/api/...`        |
| `MySQL`    | `mysql`                      | MySQL/MariaDB connection check                                         |
| `Postgres` | `postgres`                   | PostgreSQL connection check                                            |
| `Redis`    | `redis`                      | Redis connection check                                                 |
| `MongoDB`  | `mongodb`                    | MongoDB connection check                                               |

If you add a new monitor type that isn't in the table, add a row here in the same PR.

## Groups

Top-level groups (`groups[].name`) and subgroups (`type: group`) **never** carry a type suffix. They name a category, not a check:

- `HomeLab`, `VPS`, `FreePlanningPoker`, `Hermes Agent`, `Websites` — top-level
- `Networking`, `Monitoring`, `Infra`, `Services`, `Apps`, `Files`, `Media`, `Immich`, `CouchDB`, `Infrastructure` — subgroups

## Subject conventions

- Use the canonical service name as the subject (`Glance`, `Caddy`, `Watchtower`).
- A service with multiple checks gets the same subject across them: `Glance - Docker` + `Glance - HTTP`, `API - Docker` + `API - HTTP`.
- Backup heartbeats put `Backup` in the subject, type suffix stays `Push`: `VPS Postgres Backup - Push`, `Restic Backup - Push`, `1Password Backup - Push`. **Never** use `- Backup` as the type suffix — `Backup` describes what's tracked, `Push` describes how.
- For tightly-grouped services that share a prefix (e.g. all FreePlanningPoker children), keep the namespace prefix in the subject: `FPP - Frontend - HTTP`, `FPP - DB - MySQL`. The last ` - ` still wins as the type separator.

## Examples

✅ Correct:
```
Glance - Docker
Glance - HTTP
Restic Backup - Docker
Restic Backup - Push
FPP - Frontend - HTTP
FPP - DB - MySQL
FPP - Analytics Readmodel - Push
VPS Postgres Backup - Push
Photos - HTTP
Photos - Uptime
BunEmailApi - HTTP
```

❌ Wrong:
```
Photos                          # missing type suffix
BunEmailApi                     # missing type suffix
FPP - Frontend                  # missing type suffix
VPS Postgres - Backup           # type suffix should be Push (type), not Backup (subject)
FPP - DB Backup                 # missing type suffix
```

## Renames

Rename existing monitors via the Uptime Kuma API (`api.edit_monitor(id, name=new_name)`) — this preserves heartbeat history. Then update `monitors.yaml` to match. **Never** rely on sync's create+delete-orphan path for renames, that wipes history.

Reference snippet (run on homelab so it can hit `localhost:3010`):

```python
# ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- uptime-kuma/.venv/bin/python <<'PY'
import os
from uptime_kuma_api import UptimeKumaApi
api = UptimeKumaApi('http://localhost:3010')
api.login('jkrumm', os.environ['UPTIME_KUMA_PASSWORD'])
by_name = {m['name']: m for m in api.get_monitors()}
for old, new in [('OldName','NewName')]:
    api.edit_monitor(by_name[old]['id'], name=new)
api.disconnect()
# PY"
```

## Type caveats

Two monitor types are *not* fully managed by `sync.py`. Editing them in YAML alone won't change live state — you must touch the UI:

- **`type: mysql` / `postgres` / `redis` / `mongodb` / `sqlserver`** — `sync.py` calls `[SKIP-DB]` for these once the monitor exists, so connection details (host, port, user, password, query, SSL) live only in the Kuma UI. This keeps secrets out of git. The YAML entry exists only so the monitor isn't reported as an orphan.
- **`type: push`** — `uptime-kuma-api` 1.2.1 cannot create push monitors against Uptime Kuma 2.x. Create the monitor manually in the UI first, copy its push URL into 1Password, then add the YAML entry. Subsequent edits (interval, retry, parent) sync normally.

When adding either type, leave a comment in `monitors.yaml` pointing to the 1Password path that holds the relevant secret/URL.

## Validation before commit

After editing `monitors.yaml`:

1. Every entry under `monitors:` that has no `type: group` must have a ` - <Type>` suffix matching the table above, and the suffix must agree with the entry's `type:` field.
2. Run `make uk-dry-run`. Pipe through this filter — empty output means safe to apply:

   ```bash
   make uk-dry-run 2>&1 | grep -E "ORPHANS|CREATE|ERROR"
   ```

   - `[CREATE]` on a name you didn't add → drift (likely a UI rename); reconcile YAML before syncing.
   - `[ORPHANS]` → live monitor missing from YAML; either re-add it or pass `--delete-orphans` deliberately.
   - `[ERROR]` → param shape mismatch; fix YAML, never let sync swallow it.

3. Apply with `make uk-sync` (which `git pull`s on homelab first).
