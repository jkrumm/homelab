# ntfy Skill

Manage the self-hosted ntfy notification server at `ntfy.jkrumm.com`.

**Auth:** All calls use a Bearer token (`NTFY_TOKEN` from Doppler). Run API calls via HomeLab SSH so the token stays in Doppler and never appears in local shell history.

---

## Topics Reference

| Topic | Producer | Purpose |
|-|-|-|
| `homelab-watchdog` | homelab_watchdog.sh (host cron) | System health alerts |
| `homelab-watchtower` | HomeLab Watchtower | Container update notifications |
| `vps-watchtower` | VPS Watchtower | VPS container updates |
| `uptime-alerts` | UptimeKuma | Service down/up alerts |

---

## Authentication Pattern

Single-quote wrapping so `${NTFY_TOKEN}` expands on HomeLab after Doppler injects it:

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s -H "Authorization: Bearer ${NTFY_TOKEN}" \
    https://ntfy.jkrumm.com/homelab-watchdog/json?poll=1
'"'"''
```

---

## Publishing Messages

### Basic publish

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s \
    -H "Authorization: Bearer ${NTFY_TOKEN}" \
    -H "Title: Test" \
    -H "Priority: default" \
    -H "Tags: white_check_mark" \
    -d "Message body here" \
    https://ntfy.jkrumm.com/homelab-watchdog
'"'"''
```

### Priority levels

| Value | Alias | Effect |
|-|-|-|
| `1` | `min` | Silent |
| `2` | `low` | Low-volume sound |
| `3` | `default` | Standard (default) |
| `4` | `high` | Loud, may interrupt |
| `5` | `max` | Bypasses Do Not Disturb |

### All publish headers

| Header | Example | Notes |
|-|-|-|
| `Title` | `Server Alert` | Notification title |
| `Priority` | `4` or `high` | 1–5 or min/low/default/high/max |
| `Tags` | `warning,server` | Comma-separated, maps to emojis |
| `Click` | `https://signoz.jkrumm.com` | Open URL on tap |
| `Icon` | `https://example.com/icon.png` | Small icon |
| `Markdown` | `yes` | Enable Markdown body |
| `X-Delay` | `30m` or ISO-8601 | Schedule delivery (max 24h) |

### Publish with JSON body (all-in-one)

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s https://ntfy.jkrumm.com \
    -H "Authorization: Bearer ${NTFY_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"topic\":\"homelab-watchdog\",\"title\":\"Disk Warning\",\"message\":\"SSD at 90%\",\"priority\":4,\"tags\":[\"warning\",\"cd\"]}"
'"'"''
```

### Publish with action button (HTTP call-back)

```bash
curl -s https://ntfy.jkrumm.com/homelab-watchdog \
  -H "Authorization: Bearer ${NTFY_TOKEN}" \
  -H "Title: Service Down" \
  -H 'Actions: http, Restart, https://homelab/api/restart, method=POST' \
  -d "Caddy is not responding"
```

---

## Polling / Reading Messages

### Poll cached messages for a topic

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s \
    -H "Authorization: Bearer ${NTFY_TOKEN}" \
    "https://ntfy.jkrumm.com/homelab-watchdog/json?poll=1" \
    | python3 -c "import json,sys; [print(json.loads(l).get(\"message\",\"\")) for l in sys.stdin if l.strip()]"
'"'"''
```

### Poll since timestamp (avoid duplicates)

```bash
# Replace UNIX_TS with e.g. $(date -d '1 hour ago' +%s)
curl -s -H "Authorization: Bearer $NTFY_TOKEN" \
  "https://ntfy.jkrumm.com/homelab-watchdog/json?poll=1&since=UNIX_TS"
```

---

## User Management (inside container)

```bash
# List all users
ssh homelab "docker exec ntfy ntfy user list"

# Add user (interactive password prompt — requires TTY)
ssh -t homelab "docker exec -it ntfy ntfy user add --role=admin USERNAME"

# Add user non-interactively (pipe password twice)
ssh homelab "printf 'PASS\nPASS\n' | docker exec -i ntfy ntfy user add USERNAME"

# Remove user
ssh homelab "docker exec ntfy ntfy user remove USERNAME"

# Change role
ssh homelab "docker exec ntfy ntfy user change-role USERNAME admin"

# Per-topic ACL
ssh homelab "docker exec ntfy ntfy access USERNAME 'homelab-*' rw"
```

---

## Token Management (inside container)

```bash
# List tokens for user
ssh homelab "docker exec ntfy ntfy token list jkrumm"

# Add token (no expiry)
ssh homelab "docker exec ntfy ntfy token add jkrumm --label 'label-name'"
# → outputs: token tk_XXXXXXXX  ← copy into Doppler as NTFY_TOKEN

# Remove token
ssh homelab "docker exec ntfy ntfy token remove jkrumm TOKEN_ID"
```

After creating a token, store it in Doppler:
```bash
doppler secrets set NTFY_TOKEN=tk_XXXXX --project homelab --config prod
doppler secrets set NTFY_TOKEN=tk_XXXXX --project vps --config prod
```

---

## Server Operations

```bash
# View container logs
ssh homelab "docker logs ntfy --tail=50"

# Check ntfy is reachable
curl -I https://ntfy.jkrumm.com

# Restart
ssh homelab "cd ~/homelab && doppler run -- docker compose restart ntfy"

# Disk usage (cache + user db)
ssh homelab "du -sh /home/jkrumm/ssd/ntfy/*"
```

---

## Config Reference (`config/ntfy/server.yml`)

```yaml
base-url: "https://ntfy.jkrumm.com"
listen-http: ":80"
auth-file: "/var/lib/ntfy/user.db"
auth-default-access: "deny-all"      # anonymous access blocked
behind-proxy: true                   # trust X-Forwarded-For from Caddy
upstream-base-url: "https://ntfy.sh" # iOS push relay via ntfy.sh APNs
cache-file: "/var/lib/ntfy/cache.db"
cache-duration: "12h"
log-level: "info"
```

Storage: `/home/jkrumm/ssd/ntfy` (user.db + cache.db)
Host port: `127.0.0.1:8093:80` — used by watchdog cron on host directly.

---

## iOS App Setup

1. Install **ntfy** from the App Store
2. Settings → Default server → `https://ntfy.jkrumm.com`
3. Add auth: Settings → Manage users → add token `tk_XXXXX` for `ntfy.jkrumm.com`
4. Subscribe to topics: `homelab-watchdog`, `homelab-watchtower`, `vps-watchtower`, `uptime-alerts`

iOS push works via ntfy.sh relay (configured in server.yml `upstream-base-url`).
