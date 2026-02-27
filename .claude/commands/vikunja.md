# Vikunja Skill

Manage the self-hosted Vikunja task management instance at `vikunja.jkrumm.com`.

**Auth:** API calls use a Bearer token (`VIKUNJA_API_TOKEN` from Doppler). Admin password in `VIKUNJA_ADMIN_PASSWORD`.

---

## Environment Variables (Doppler: homelab/prod)

| Variable | Purpose |
|-|-|
| `VIKUNJA_JWT_SECRET` | JWT signing secret (invalidating rotates all sessions) |
| `VIKUNJA_ADMIN_PASSWORD` | Admin user password |
| `VIKUNJA_API_TOKEN` | No-expiry API token for automation |

---

## User Management

The vikunja Docker image has no CLI tools. User management is done via SQLite directly or the REST API.

**Admin user creation** (if needed from scratch):
```bash
# Generate bcrypt hash ($2a$ prefix required for Go/Vikunja)
ADMIN_PW=$(doppler secrets get VIKUNJA_ADMIN_PASSWORD --plain --project homelab --config prod)
bun -e "import bcrypt from 'bcryptjs'; console.log(bcrypt.hashSync('$ADMIN_PW', 14).replace(/^\\\$2b\\\$/, '\$2a\$'))"

# Insert user via Python script on server (avoid shell \$ expansion)
# Generate script locally → scp → run on server
```

**Key fields for local accounts:**
- `issuer` must be `'local'` — if NULL, Vikunja shows "third-party provider" error
- `password` must use `$2a$` bcrypt prefix (not `$2b$` from bcryptjs/Node.js — replace prefix)
- `status` = 0 (active)

---

## API Authentication

### Login to get JWT

Note: In Vikunja v2, the login endpoint is `/api/v1/login` (not `/api/v1/user/login`).

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s -X POST http://localhost:3456/api/v1/login \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"jkrumm\",\"password\":\"${VIKUNJA_ADMIN_PASSWORD}\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)[\"token\"])"
'"'"''
```

### Use API token (preferred for automation)

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s -H "Authorization: Bearer ${VIKUNJA_API_TOKEN}" \
    https://vikunja.jkrumm.com/api/v1/tasks/all | python3 -m json.tool
'"'"''
```

---

## API Token Management

### Create permanent API token (no expiry)

First get a JWT, then:

```bash
# Replace JWT_TOKEN with value from login step
ssh homelab "curl -s -X PUT http://localhost:3456/api/v1/tokens \
  -H 'Authorization: Bearer JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{\"title\":\"homelab-api\"}' | python3 -m json.tool"
# Copy token value → store in Doppler as VIKUNJA_API_TOKEN
doppler secrets set VIKUNJA_API_TOKEN="TOKEN_VALUE" --project homelab --config prod
```

### List tokens

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s -H "Authorization: Bearer ${VIKUNJA_API_TOKEN}" \
    http://localhost:3456/api/v1/tokens | python3 -m json.tool
'"'"''
```

### Delete a token

```bash
# Replace TOKEN_ID with numeric ID from list
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s -X DELETE \
    -H "Authorization: Bearer ${VIKUNJA_API_TOKEN}" \
    http://localhost:3456/api/v1/tokens/TOKEN_ID
'"'"''
```

---

## Common API Operations

```bash
# Get all tasks
curl -s -H "Authorization: Bearer TOKEN" https://vikunja.jkrumm.com/api/v1/tasks/all

# Get all projects
curl -s -H "Authorization: Bearer TOKEN" https://vikunja.jkrumm.com/api/v1/projects

# Create a task
curl -s -X PUT \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Task title","project_id":1}' \
  https://vikunja.jkrumm.com/api/v1/projects/1/tasks
```

Full API docs: https://vikunja.io/docs/ | Swagger: https://try.vikunja.io/api/v1/docs

---

## Server Operations

```bash
# View logs
ssh homelab "docker logs vikunja --tail=50"

# Container health
ssh homelab "docker inspect vikunja --format='{{.State.Health.Status}}'"

# Restart
ssh homelab "cd ~/homelab && doppler run -- docker compose restart vikunja"

# Check API info (no auth required)
curl -s https://vikunja.jkrumm.com/api/v1/info | python3 -m json.tool
```

---

## Backup

SQLite database — single file copy:

```bash
# Backup database
ssh homelab "cp /home/jkrumm/ssd/vikunja/data/vikunja.db /home/jkrumm/ssd/vikunja/data/vikunja.db.bak"

# Backup files (attachments)
ssh homelab "tar -czf /tmp/vikunja-files-backup.tar.gz /home/jkrumm/ssd/vikunja/files"
```

Duplicati covers both paths under `/home/jkrumm/ssd`.

---

## JWT Secret Rotation

Rotating `VIKUNJA_JWT_SECRET` invalidates **all active sessions** (all users re-authenticate):

```bash
# Generate new secret and update Doppler
doppler secrets set VIKUNJA_JWT_SECRET="$(openssl rand -hex 32)" --project homelab --config prod

# Redeploy to apply
ssh homelab "cd ~/homelab && git pull && doppler run -- docker compose up -d --force-recreate vikunja"
```

---

## Config Reference (via environment variables)

| Variable | Default | Purpose |
|-|-|-|
| `VIKUNJA_DATABASE_TYPE` | `sqlite` | DB engine |
| `VIKUNJA_DATABASE_PATH` | `/app/vikunja/data/vikunja.db` | SQLite file path |
| `VIKUNJA_SERVICE_PUBLICURL` | `https://vikunja.jkrumm.com` | Public URL for links |
| `VIKUNJA_SERVICE_JWTSECRET` | Doppler | JWT signing key |
| `VIKUNJA_SERVICE_JWTTTL` | `7776000` | Access token TTL (90 days) |
| `VIKUNJA_SERVICE_JWTTTLLONG` | `7776000` | Remember me TTL (90 days) |
| `VIKUNJA_SERVICE_ENABLEREGISTRATION` | `false` | No public registration |
| `VIKUNJA_SERVICE_TIMEZONE` | `Europe/Berlin` | Server timezone |
| `VIKUNJA_MAILER_ENABLED` | `false` | No email sending |
| `VIKUNJA_SERVICE_ENABLEEMAILREMINDERS` | `false` | No email reminders |

Storage: `/home/jkrumm/ssd/vikunja/` (data/ + files/)
Container port: `3456`
Host binding: `127.0.0.1:3456:3456` (localhost only, accessed via Caddy)
