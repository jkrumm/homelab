# ntfy Skill

Manage the self-hosted ntfy notification server at `ntfy.jkrumm.com`.

**Auth:** All API calls use a Bearer token (`NTFY_TOKEN` from 1Password). Run API calls via HomeLab SSH so the token stays in 1Password and never appears in local shell history.

---

## Topics Reference

| Topic | Producer | Purpose |
|-|-|-|
| `homelab-watchdog` | homelab_watchdog.sh (host cron) | System health alerts |
| `homelab-watchtower` | HomeLab Watchtower | Container update notifications |
| `vps-watchtower` | VPS Watchtower | VPS container updates |
| `uptime-alerts` | UptimeKuma | Service down/up alerts |

All 4 topics are reserved by `jkrumm` (topic ownership in user.db).

---

## Authentication Pattern

Single-quote wrapping so `${NTFY_TOKEN}` expands on HomeLab after 1Password injects it:

```bash
ssh homelab 'op run --env-file=~/homelab/.env.tpl -- bash -c '"'"'
  curl -s -H "Authorization: Bearer ${NTFY_TOKEN}" \
    "https://ntfy.jkrumm.com/homelab-watchdog/json?poll=1"
'"'"''
```

---

## Publishing Messages

### Basic publish

```bash
ssh homelab 'op run --env-file=~/homelab/.env.tpl -- bash -c '"'"'
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
ssh homelab 'op run --env-file=~/homelab/.env.tpl -- bash -c '"'"'
  curl -s https://ntfy.jkrumm.com \
    -H "Authorization: Bearer ${NTFY_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"topic\":\"homelab-watchdog\",\"title\":\"Disk Warning\",\"message\":\"SSD at 90%\",\"priority\":4,\"tags\":[\"warning\",\"cd\"]}"
'"'"''
```

---

## Polling / Reading Messages

### Poll cached messages for a topic

```bash
ssh homelab 'op run --env-file=~/homelab/.env.tpl -- bash -c '"'"'
  curl -s \
    -H "Authorization: Bearer ${NTFY_TOKEN}" \
    "https://ntfy.jkrumm.com/homelab-watchdog/json?poll=1" \
    | python3 -c "import json,sys; [print(json.loads(l).get(\"message\",\"\")) for l in sys.stdin if l.strip()]"
'"'"''
```

### Poll since timestamp (avoid duplicates)

```bash
# Replace UNIX_TS with e.g. $(date -d '1 hour ago' +%s)
ssh homelab 'op run --env-file=~/homelab/.env.tpl -- bash -c '"'"'
  curl -s -H "Authorization: Bearer ${NTFY_TOKEN}" \
    "https://ntfy.jkrumm.com/homelab-watchdog/json?poll=1&since=UNIX_TS"
'"'"''
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

# Change password (pipe new password twice)
ssh homelab "printf 'NEWPASS\nNEWPASS\n' | docker exec -i ntfy ntfy user change-pass USERNAME"

# Remove user
ssh homelab "docker exec ntfy ntfy user remove USERNAME"

# Change role
ssh homelab "docker exec ntfy ntfy user change-role USERNAME admin"

# Assign tier to user
ssh homelab "docker exec ntfy ntfy user change-tier USERNAME TIER_CODE"
```

---

## Token Management (inside container)

```bash
# List tokens for user
ssh homelab "docker exec ntfy ntfy token list jkrumm"

# Add token (no expiry)
ssh homelab "docker exec ntfy ntfy token add jkrumm --label 'label-name'"
# → outputs: token tk_XXXXXXXX  ← update in 1Password common/ntfy/TOKEN

# Remove token
ssh homelab "docker exec ntfy ntfy token remove jkrumm TOKEN_ID"
```

After creating a token, update in 1Password:
```bash
op item edit ntfy --vault common "TOKEN[password]=tk_XXXXX"
```

---

## Tier Management

Tiers control reservation limits (how many topics a user can own/reserve) and message quotas.
Admin users with no tier get 0 reservations. Assign a tier to grant reservation slots.

```bash
# List tiers
ssh homelab "docker exec ntfy ntfy tier list"

# Add a tier
ssh homelab "docker exec ntfy ntfy tier add \
  --name='HomeLab' \
  --reservation-limit=50 \
  --message-limit=50000 \
  --message-expiry-duration=24h \
  homelab"

# Assign tier to user
ssh homelab "docker exec ntfy ntfy user change-tier jkrumm homelab"

# Check account limits (shows reservations_remaining etc.)
ssh homelab 'op run --env-file=~/homelab/.env.tpl -- bash -c '"'"'
  curl -s -H "Authorization: Bearer ${NTFY_TOKEN}" \
    https://ntfy.jkrumm.com/v1/account | python3 -m json.tool
'"'"''
```

### Topic Reservations (via API)

Reserve a topic so it appears in the iOS/web app as "owned":

```bash
ssh homelab 'op run --env-file=~/homelab/.env.tpl -- bash -c '"'"'
  curl -s -X POST \
    -H "Authorization: Bearer ${NTFY_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://ntfy.jkrumm.com/v1/account/reservation" \
    -d "{\"topic\":\"homelab-watchdog\",\"everyone\":\"deny-all\"}"
'"'"''
```

`everyone` values: `"deny-all"` (private), `"read-only"` (public read), `"read-write"` (public).

---

## Server Operations

```bash
# View container logs
ssh homelab "docker logs ntfy --tail=50"

# Check ntfy is reachable + version
curl -s https://ntfy.jkrumm.com/v1/health | python3 -m json.tool

# Check server config (web push, login status, etc.)
curl -s https://ntfy.jkrumm.com/v1/config | python3 -m json.tool

# Restart
ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- docker compose restart ntfy"

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
enable-login: true                   # required for web UI + iOS app auth flow
enable-reservations: true            # required for iOS app topic subscriptions
visitor-subscription-limit: 30       # per-IP anon subscription cap (auth users use tier)
upstream-base-url: "https://ntfy.sh" # iOS push relay via ntfy.sh APNs
web-push-public-key: "BLi5DS2..."   # VAPID public key (in git)
web-push-file: "/var/lib/ntfy/webpush.db"
# Private key and email injected via NTFY_WEB_PUSH_PRIVATE_KEY / NTFY_WEB_PUSH_EMAIL_ADDRESS (1Password)
cache-file: "/var/lib/ntfy/cache.db"
cache-duration: "12h"
log-level: "info"
```

**Key learnings:**
- `enable-login: true` is required — without it, web UI shows no login button and iOS cannot authenticate
- `enable-reservations: true` alone is insufficient — user must also have a **tier** with `reservation-limit > 0`
- Tier must be created with `ntfy tier add` and assigned with `ntfy user change-tier` — admin users still get 0 reservations without a tier
- VAPID Web Push: endpoint is `POST /v1/webpush` (subscribe), public key served via `GET /v1/config` — not `/v1/webpush/public-key` (that path doesn't exist)
- `visitor-subscription-limit` affects anonymous/IP-based visitors only, not authenticated users (who are governed by their tier)

Storage: `/home/jkrumm/ssd/ntfy` (user.db + cache.db + webpush.db)
Host port: `127.0.0.1:8093:80` — used by watchdog cron on host directly.

---

## iOS App Setup

1. Install **ntfy** from the App Store
2. On main screen tap **+** → subscribe to `homelab-watchdog` on `https://ntfy.jkrumm.com`
3. You'll get a "403 Forbidden" — expected since `auth-default-access: deny-all`
4. Settings (gear icon) → **Manage users** → **+** → add `https://ntfy.jkrumm.com`
   - Username: `jkrumm`
   - Password: from 1Password `NTFY_PASSWORD`
5. Retry subscribing to topics — you should now see **homelab-watchdog**, **homelab-watchtower**, **vps-watchtower**, **uptime-alerts**

iOS push works via ntfy.sh relay (`upstream-base-url: "https://ntfy.sh"`):
- Your server sends a poll_request to ntfy.sh → ntfy.sh pings APNs → iOS app wakes → fetches actual message from YOUR server (content stays private)

**Token auth in iOS app (alternative):**
- Username: `token`
- Password: `tk_XXXXXXXX` (value of `NTFY_TOKEN` from 1Password)

---

## Web UI / PWA

Visit `https://ntfy.jkrumm.com`:
1. Click **Log in** (top right) → username `jkrumm` + password from 1Password
2. Subscribe to topics via **+** button
3. Install as PWA: browser address bar → **Install** button (Chrome/Edge) or Share → Add to Home Screen (Safari/iOS)

Web Push (browser background notifications) is enabled via VAPID. After PWA install, you'll receive notifications even when the browser tab is closed.

**Check Web Push config:**
```bash
curl -s https://ntfy.jkrumm.com/v1/config | python3 -c "import json,sys; d=json.load(sys.stdin); print('web_push:', d['enable_web_push'], '| key:', d['web_push_public_key'][:20], '...')"
```
