# Cloudflare API Skill

Handle any Cloudflare DNS or tunnel operation for HomeLab-hosted apps.

**Execution model:** All API calls run on HomeLab via `ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'...'"'"''`. The API token stays in Doppler — never passed as a literal value.

---

## Required Doppler Secrets

All 4 secrets are now in `homelab` / `prod`:

| Secret | What it is |
|-|-|
| `CLOUDFLARE_API_TOKEN` | Zone:Read + DNS:Edit (all zones) + Tunnel:Edit — same token as VPS |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_ZONE_ID` | Zone ID for `jkrumm.com` |
| `CLOUDFLARE_TUNNEL_ID` | UUID of the HomeLab Cloudflare Tunnel |

---

## Infrastructure Context

### HomeLab Tunnel Architecture

Traffic flow: `Internet → Cloudflare CDN → CF Tunnel → cloudflared → http://caddy:80 → container`

The HomeLab uses **specific per-subdomain ingress rules** (not a wildcard like VPS). The catch-all at the end returns 404 for any unregistered subdomain.

**Current public ingress routes:**

| Hostname | Service |
|-|-|
| `glance.jkrumm.com` | `http://caddy:80` |
| `immich.jkrumm.com` | `http://caddy:80` |
| `uptime.jkrumm.com` | `http://caddy:80` |
| `draw.jkrumm.com` | `http://caddy:80` |
| `public.jkrumm.com` | `http://caddy:80` |
| `otlp.jkrumm.com` | `http://caddy:80` |
| `plausible.jkrumm.com` | `http://caddy:80` |
| `registry.jkrumm.com` | `http://caddy:80` |
| `rollhook-homelab.jkrumm.com` | `http://caddy:80` |
| catch-all | `http_status:404` |

**Adding a new public service requires all three:**
1. DNS CNAME record pointing subdomain to tunnel
2. New ingress rule in the tunnel config (before catch-all) — no wildcard exists
3. New site block in `Caddyfile` (both HTTPS and HTTP variants)

Private services (Tailscale-only) skip the tunnel entirely — only Caddy routing needed.

---

## Authentication Pattern

Use single-quote wrapping so `${VARS}` are expanded by the HomeLab shell after Doppler injects them:

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'
  curl -s "https://api.cloudflare.com/client/v4/zones" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    | python3 -m json.tool
'"'"''
```

**Why:** Double-quoting the SSH command causes the local shell to expand `${CLOUDFLARE_API_TOKEN}` before it reaches HomeLab (producing an empty string and auth error). The `'...' '"'"' '...'` pattern passes the inner string literally to the remote shell where Doppler has already injected the secrets.

---

## Common Operations

### List all zones

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'curl -s "https://api.cloudflare.com/client/v4/zones" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | python3 -c "import json,sys; r=json.load(sys.stdin); [print(z[\"name\"],z[\"id\"]) for z in r[\"result\"]] if r[\"success\"] else print(\"ERR:\",r[\"errors\"])"'"'"''
```

### Check current tunnel ingress config

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'curl -s "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${CLOUDFLARE_TUNNEL_ID}/configurations" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | python3 -c "import json,sys; r=json.load(sys.stdin); [print(i.get(\"hostname\",\"catch-all\"),\"→\",i[\"service\"]) for i in r[\"result\"][\"config\"][\"ingress\"]] if r[\"success\"] else print(\"ERR:\",r[\"errors\"])"'"'"''
```

### List DNS records for jkrumm.com

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'curl -s "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?per_page=100" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | python3 -c "import json,sys; r=json.load(sys.stdin); [print(rec[\"type\"],rec[\"name\"],\"→\",rec[\"content\"]) for rec in r[\"result\"]] if r[\"success\"] else print(\"ERR:\",r[\"errors\"])"'"'"''
```

### Add a DNS CNAME record (new public subdomain)

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json" --data "{\"type\":\"CNAME\",\"name\":\"SUBDOMAIN\",\"content\":\"${CLOUDFLARE_TUNNEL_ID}.cfargotunnel.com\",\"proxied\":true}" | python3 -c "import json,sys; r=json.load(sys.stdin); print(\"OK:\",r[\"result\"][\"name\"]) if r[\"success\"] else print(\"ERR:\",r[\"errors\"])"'"'"''
```

Replace `SUBDOMAIN` with the actual subdomain before running.

### Delete a DNS record

First list records to find the ID, then:

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/RECORD_ID" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | python3 -c "import json,sys; r=json.load(sys.stdin); print(\"OK\" if r[\"success\"] else r[\"errors\"])"'"'"''
```

### Update tunnel ingress config

**Always PUT the complete ingress list** — this call replaces the entire config. Must end with the `http_status:404` catch-all. Get the current config first, then PUT the updated list.

Example adding `newapp.jkrumm.com`:

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${CLOUDFLARE_TUNNEL_ID}/configurations" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json" --data "{\"config\":{\"ingress\":[{\"hostname\":\"glance.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"hostname\":\"immich.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"hostname\":\"uptime.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"hostname\":\"draw.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"hostname\":\"public.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"hostname\":\"otlp.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"hostname\":\"plausible.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"hostname\":\"registry.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"hostname\":\"rollhook-homelab.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"hostname\":\"newapp.jkrumm.com\",\"service\":\"http://caddy:80\"},{\"service\":\"http_status:404\"}]}}" | python3 -c "import json,sys; r=json.load(sys.stdin); print(\"OK — version\",r[\"result\"][\"version\"]) if r[\"success\"] else print(\"ERR:\",r[\"errors\"])"'"'"''
```

### Look up Zone ID for a secondary domain

```bash
ssh homelab 'doppler run --project homelab --config prod -- bash -c '"'"'curl -s "https://api.cloudflare.com/client/v4/zones?name=other-domain.com" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | python3 -c "import json,sys; r=json.load(sys.stdin)[\"result\"]; print(r[0][\"id\"],r[0][\"name\"]) if r else print(\"not found\")"'"'"''
```

---

## Workflow: Add a New Public App

1. **Update `Caddyfile` locally** — add site blocks (HTTPS + HTTP variant for cloudflared):
   ```
   newapp.jkrumm.com {
     tls {
       dns cloudflare {env.CLOUDFLARE_API_TOKEN}
     }
     reverse_proxy newapp:PORT
   }

   http://newapp.jkrumm.com {
     reverse_proxy newapp:PORT
   }
   ```

2. **Update `docker-compose.yml`** — add service, add it to the `cloudflared` network

3. **Add DNS CNAME record** — use "Add DNS CNAME record" above (replace `SUBDOMAIN`)

4. **Update tunnel ingress config** — PUT the full list with the new hostname added before the catch-all

5. **Push and deploy:**
   ```bash
   git push
   ssh homelab "cd ~/homelab && git pull && doppler run -- docker compose up -d --force-recreate caddy newapp"
   ```

6. **Verify:** `curl -I https://newapp.jkrumm.com`

7. **Add to `uptime-kuma/monitors.yaml`** — add HTTP monitor, then sync:
   ```bash
   ssh homelab "cd ~/homelab && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py"
   ```

---

## Workflow: Add a New Private App (Tailscale-only)

No tunnel changes needed:
1. **Update `Caddyfile`** — add HTTPS site block only (no HTTP variant)
2. **Update `docker-compose.yml`** — add service
3. **Push and deploy** as above
4. **Add to `uptime-kuma/monitors.yaml`** — add Docker container monitor

---

## Useful Reference

CF API base: `https://api.cloudflare.com/client/v4`

| Endpoint | Method | Purpose |
|-|-|-|
| `/zones` | GET | List zones (`?name=domain.com` to filter) |
| `/zones/{zone_id}/dns_records` | GET | List DNS records |
| `/zones/{zone_id}/dns_records` | POST | Create DNS record |
| `/zones/{zone_id}/dns_records/{id}` | DELETE | Delete DNS record |
| `/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations` | GET | Get tunnel ingress config |
| `/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations` | PUT | Replace tunnel ingress config |

All responses: `{"success": bool, "result": ..., "errors": [...]}`.
