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

## Validation before commit

After editing `monitors.yaml`:

1. Every entry under `monitors:` that has no `type: group` must have a ` - <Type>` suffix matching the table above.
2. The suffix's `<Type>` must agree with the entry's `type:` field.
3. Run `make uk-dry-run` — output should show `[UPDATE]` for changed entries and no `[ORPHANS]`.
