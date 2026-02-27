# ntfy Skill

Manage the self-hosted ntfy notification server at `ntfy.jkrumm.com`.

**Execution model:** All commands run on HomeLab via SSH. The `NTFY_TOKEN` is stored in Doppler.

---

## Topics Reference

| Topic | Producer | Purpose |
|-|-|-|
| `homelab-watchdog` | homelab_watchdog.sh (cron) | System health alerts |
| `homelab-watchtower` | HomeLab Watchtower | Container update notifications |
| `vps-watchtower` | VPS Watchtower | VPS container updates |
| `uptime-alerts` | UptimeKuma | Service down/up alerts |

---

## Authentication Pattern

Use single-quote wrapping so `${VARS}` are expanded by the HomeLab shell after Doppler injects them:

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s -H "Authorization: Bearer ${NTFY_TOKEN}" \
    https://ntfy.jkrumm.com/homelab-watchdog/json?poll=1
'"'"''
```

---

## Common Operations

### Publish a test notification

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s \
    -H "Authorization: Bearer ${NTFY_TOKEN}" \
    -H "Title: Test Notification" \
    -d "ntfy is live" \
    https://ntfy.jkrumm.com/homelab-watchdog
'"'"''
```

### List users

```bash
ssh homelab "docker exec ntfy ntfy user list"
```

### Add a user

```bash
# Interactive (TTY required for password prompt)
ssh -t homelab "docker exec -it ntfy ntfy user add --role=admin USERNAME"
```

### List tokens for a user

```bash
ssh homelab "docker exec ntfy ntfy token list USERNAME"
```

### Add a token (no expiry)

```bash
ssh homelab "docker exec ntfy ntfy token add USERNAME --label LABEL"
```

### Remove a token

```bash
ssh homelab "docker exec ntfy ntfy token remove USERNAME TOKEN_ID"
```

### View cached messages for a topic

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s \
    -H "Authorization: Bearer ${NTFY_TOKEN}" \
    "https://ntfy.jkrumm.com/homelab-watchdog/json?poll=1" \
    | python3 -c "import json,sys; [print(json.loads(l).get(\"message\",\"\")) for l in sys.stdin]"
'"'"''
```

### Check ntfy container logs

```bash
ssh homelab "docker logs ntfy --tail=50"
```

### Verify ntfy is reachable

```bash
curl -I https://ntfy.jkrumm.com
```

---

## iOS App Setup

1. Install **ntfy** from the App Store
2. Open Settings → Default server → `https://ntfy.jkrumm.com`
3. Add token: Settings → Users → Add credentials → token `tk_XXXXX` (from Doppler `NTFY_TOKEN`)
4. Subscribe to topics: `homelab-watchdog`, `homelab-watchtower`, `vps-watchtower`, `uptime-alerts`
5. iOS push is relayed via `ntfy.sh` (upstream-base-url configured in `config/ntfy/server.yml`)

---

## Useful Reference

| Path | Purpose |
|-|-|
| `config/ntfy/server.yml` | Server config (auth-file, upstream, cache) |
| `/home/jkrumm/ssd/ntfy` | Persistent data (user.db, cache.db) |
| `127.0.0.1:8093` | Host-exposed port (used by watchdog cron) |
