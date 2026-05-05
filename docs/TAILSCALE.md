# Tailscale + Caddy Setup for VPS + HomeLab

## Context

Both machines expose **all** services through Cloudflare Tunnel, including admin tools (Beszel, Dozzle, FileBrowser) that only you access. Goal: Use Tailscale for private services with your own `jkrumm.com` subdomains, Caddy as config-as-code reverse proxy for all routing, and Cloudflare only for truly public services.

**Tailnet:** `dinosaur-sole.ts.net` (nodes get MagicDNS names like `homelab.dinosaur-sole.ts.net`, but we use `jkrumm.com` subdomains via Caddy for services)

---

## Architecture Overview

```
Public services (Glance, Immich, UptimeKuma, ...):
  Internet → Cloudflare CDN (orange cloud) → CF Tunnel → cloudflared → http://caddy:80 → container

Private services (Beszel, Dozzle, ...):
  Your device → Tailscale → HomeLab TS IP → https://caddy:443 → container
  DNS: beszel.jkrumm.com → A record 100.x.y.z (grey cloud, DNS-only in Cloudflare)
```

**Key insight:** Caddy handles ALL routing. The Caddyfile is the single source of truth. Cloudflare tunnel just forwards `*.jkrumm.com` to Caddy. Private service DNS records point to the Tailscale IP (100.x.y.z) - unreachable from public internet, only from your Tailscale devices.

**TLS:** Caddy gets Let's Encrypt certs via Cloudflare DNS-01 challenge (works even for domains resolving to private IPs). Requires the `caddy-dns/cloudflare` plugin.

**Dual access (critical detail):** Caddy serves both HTTP (port 80, for cloudflared) and HTTPS (port 443, for Tailscale). The global `auto_https disable_redirects` setting keeps HTTPS certs working but removes the HTTP→HTTPS redirect so cloudflared can connect via `http://caddy:80` without getting a 301.

---

## MagicDNS Explained

Tailscale runs a local DNS server at `100.100.100.100` on every device. It resolves tailnet names (`homelab.dinosaur-sole.ts.net`) to Tailscale IPs instantly (no external DNS query, zero latency). Every device also gets a short name (`homelab`) via DNS search domains.

**On Linux hosts:** With `systemd-resolved` (Ubuntu 24.04 uses this), MagicDNS registers as a per-interface DNS on `tailscale0`. No `/etc/resolv.conf` modification.

**Inside Docker containers:** Containers on user-defined bridge networks use Docker's internal DNS (`127.0.0.11`) and do NOT see MagicDNS. To resolve tailnet names from inside containers, add explicit DNS:

```yaml
dns:
  - 100.100.100.100
  - 1.1.1.1
```

**IP routing works without DNS:** Even without MagicDNS resolution, Docker containers CAN route traffic to Tailscale IPs (`100.x.y.z`). The host's routing table handles `100.64.0.0/10` via `tailscale0`, and Docker bridge uses the host as default gateway. So using raw Tailscale IPs in container configs always works.

---

## Service Classification

### HomeLab - Stay on Cloudflare (public)

| Service    | Port | Domain            | Reason                                |
| ---------- | ---- | ----------------- | ------------------------------------- |
| Glance     | 8080 | glance.jkrumm.com | Personal dashboard, convenient public |
| Immich     | 2283 | immich.jkrumm.com | Photo sharing with others             |
| UptimeKuma | 3010 | uptime.jkrumm.com | Public status page                    |
| ExcaliDash | 8084 | draw.jkrumm.com   | Shared whiteboard                     |
| Dufs       | 8098 | public.jkrumm.com | Public file sharing                   |

### HomeLab - Move to Tailscale only (private)

| Service     | Port | Domain               | Reason                  |
| ----------- | ---- | -------------------- | ----------------------- |
| Beszel      | 8090 | beszel.jkrumm.com    | Admin monitoring        |
| Dozzle      | 8081 | dozzle.jkrumm.com    | Admin log viewer        |
| FileBrowser | 8095 | files.jkrumm.com     | File management         |
| Calibre GUI | 8085 | calibre.jkrumm.com   | Book management admin   |
| Calibre-Web | 8083 | books.jkrumm.com     | Personal e-book library |

### VPS - Stay on Cloudflare (public apps)

FPP (Next.js on Vercel), Analytics, Snow-Finder, Email API, Plausible, Photos - all public. Tailscale only needed for SSH + agent connections.

> **Note on MariaDB:** The FPP Next.js app on Vercel connects to MariaDB on `5.75.178.196:33306`. Since Vercel is NOT on our tailnet, MariaDB must keep its public port binding. Consider firewall rules to restrict access to Vercel's IP ranges for extra security.

---

## Phase 1: Tailscale admin console setup (BEFORE installing on servers) ✅ DONE

Tags must exist in ACLs before `tailscale up --advertise-tags` can use them. Do this first.

In [Tailscale Admin Console](https://login.tailscale.com/admin):

1. **DNS tab:** Verify MagicDNS is enabled, enable HTTPS certificates
2. **Access Controls tab** - set up tags and SSH policy:
   ```jsonc
   {
     "tagOwners": {
       "tag:homelab": ["autogroup:admin"],
       "tag:vps": ["autogroup:admin"],
       "tag:container": ["autogroup:admin"],
     },
     "grants": [{ "src": ["*"], "dst": ["*"], "ip": ["*"] }],
     "ssh": [
       {
         "action": "accept",
         "src": ["autogroup:admin"],
         "dst": ["tag:homelab", "tag:vps"],
         "users": ["autogroup:nonroot", "root"],
       },
     ],
   }
   ```

> **Learning:** Tailscale's default ACL config uses the newer `grants` format, not the older `acls` format. Use `grants` with `{"src": ["*"], "dst": ["*"], "ip": ["*"]}` instead of `acls` with `{"action": "accept", "src": ["*"], "dst": ["*:*"]}`.

---

## Phase 2: Install Tailscale natively on both hosts ✅ DONE

**HomeLab** (Ubuntu 24.04 x86_64):

```bash
ssh jkrumm@homelab.jkrumm.com
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --advertise-tags=tag:homelab
tailscale ip -4  # → <tailscale-ip-homelab>
```

**VPS** (Ubuntu 22.04 ARM64 / Hetzner):

```bash
ssh jkrumm@5.75.178.196
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --advertise-tags=tag:vps
tailscale ip -4  # → <tailscale-ip-sds>
```

> **Learning (VPS):** Hetzner apt mirrors can 404 during `apt-get update`, causing the install script to fail mid-way. The Tailscale repo gets added successfully though. Fix: run `sudo apt-get install -y tailscale` separately after the script fails. Also, VPS package upgrades may prompt for daemon restarts - accept defaults (safe to restart containerd, Docker containers survive with restart policies).

> **Learning:** Both servers require sudo password for install. Can't be done non-interactively via `ssh host "command"` - must be done in interactive SSH sessions.

**Results:**

| Machine | Tailscale IP           | MagicDNS Name                                 | Tag         |
| ------- | ---------------------- | --------------------------------------------- | ----------- |
| HomeLab | <tailscale-ip-homelab> | homelab.dinosaur-sole.ts.net                  | tag:homelab |
| VPS     | <tailscale-ip-sds>     | sideproject-docker-stack.dinosaur-sole.ts.net | tag:vps     |
| MacBook | <tailscale-ip-macbook> | iu-mac-book                                   | (personal)  |
| iPhone  | <tailscale-ip-iphone>  | iphone-15                                     | (personal)  |

**Verification (all passed):**

- `tailscale status` on each machine shows all 4 devices
- `tailscale ping homelab` from MacBook → pong via DERP(nue) ~130ms (direct connection establishes over time)
- `tailscale ping sideproject-docker-stack` from MacBook → pong via DERP(nue) ~100ms
- All 26 HomeLab containers still running, all services accessible via Cloudflare
- SSH via Tailscale IPs works for both machines

**Also completed (from Phase 8, done early):**

- `~/.ssh/config` created with `homelab` → `<tailscale-ip-homelab>`, `vps` → `<tailscale-ip-sds>`, plus `homelab-direct` and `vps-direct` fallbacks
- `~/.zshrc` aliases updated: `homelab` → `ssh homelab`, `vps` → `ssh vps`
- Host keys accepted for both Tailscale IPs
- `ssh homelab` and `ssh vps` verified working through Tailscale

---

## Phase 3: Add Caddy to HomeLab ✅ DONE

HomeLab currently has no reverse proxy. Add Caddy with the Cloudflare DNS plugin.

### 3a. Create Caddy Dockerfile

**File:** `~/homelab/caddy/Dockerfile`

```dockerfile
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

### 3b. Create initial Caddyfile

**File:** `~/homelab/Caddyfile`

Start with just one service to test, then expand:

```caddyfile
{
	acme_dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	auto_https disable_redirects
}

# Test: proxy Glance (still on Cloudflare too)
glance.jkrumm.com {
	reverse_proxy glance:8080
}
```

> `auto_https disable_redirects` is critical: keeps HTTPS + cert provisioning working (for Tailscale access) but removes the HTTP→HTTPS redirect (so cloudflared can connect via `http://caddy:80` without getting a 301).

### 3c. Add Caddy to docker-compose.yml

**File:** `~/homelab/docker-compose.yml`

```yaml
caddy:
  build:
    context: ./caddy
    dockerfile: Dockerfile
  container_name: caddy
  restart: unless-stopped
  ports:
    - '443:443'
    - '80:80'
  networks:
    - cloudflared
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile
    - caddy_data:/data
    - caddy_config:/config
  environment:
    - CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
  labels:
    glance.parent: uptime
    glance.name: Caddy
    glance.hide: false
```

Add volumes:

```yaml
volumes:
  caddy_data:
  caddy_config:
```

### 3d. Deploy and test

```bash
ssh jkrumm@homelab.jkrumm.com "cd ~/homelab && git pull && op run --env-file=.env.tpl -- docker compose up -d caddy"
```

Test from MacBook: `curl -v https://glance.jkrumm.com:443` (via Tailscale IP, verify cert is valid).

---

## Phase 4: Migrate HomeLab routing through Caddy ✅ DONE

### 4a. Expand Caddyfile with all services

**File:** `~/homelab/Caddyfile`

```caddyfile
{
	acme_dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	auto_https disable_redirects
}

# === PUBLIC SERVICES (Cloudflare + Tailscale) ===

glance.jkrumm.com {
	reverse_proxy glance:8080
}

immich.jkrumm.com {
	reverse_proxy immich_server:2283
}

uptime.jkrumm.com {
	reverse_proxy uptime-kuma:3001
}

draw.jkrumm.com {
	reverse_proxy excalidash-frontend:80
}

public.jkrumm.com {
	reverse_proxy dufs:5000
}

# === PRIVATE SERVICES (Tailscale only) ===

beszel.jkrumm.com {
	reverse_proxy beszel:8090
}

dozzle.jkrumm.com {
	reverse_proxy dozzle:8081
}

files.jkrumm.com {
	reverse_proxy filebrowser:80
}

calibre.jkrumm.com {
	reverse_proxy calibre:8080
}

books.jkrumm.com {
	reverse_proxy calibre-web:8083
}
```

### 4b. Update Cloudflare Tunnel to route through Caddy

In **Cloudflare Zero Trust Dashboard** → Tunnels → homelab tunnel → Public Hostnames:

Change all routes to point to `http://caddy:80` (HTTP, not HTTPS - avoids TLS cert verification issues):

- `*.jkrumm.com` → Service: `http://caddy:80` (catch-all)

Or if catch-all isn't supported for the remotely-managed tunnel, update each public subdomain route individually to `http://caddy:80`.

> **Why HTTP?** cloudflared → Caddy is on the same Docker network (internal, already encrypted by the CF tunnel end-to-end). Using HTTP avoids cert hostname mismatch issues. The `auto_https disable_redirects` setting ensures Caddy serves content on port 80 without redirecting to HTTPS.

### 4c. Add Caddy to required Docker networks

Caddy needs to reach all services. Currently most are on `cloudflared` network. Add Caddy to other networks as needed:

```yaml
caddy:
  networks:
    - cloudflared
    - beszel # for beszel service
    - excalidash # for excalidash-frontend
```

Or simpler: ensure all user-facing services are on a shared network that Caddy is also on. The `cloudflared` network already serves this purpose for most services.

### 4d. Update cloudflared depends_on

Add `caddy` to cloudflared's dependency list:

```yaml
cloudflared:
  depends_on:
    - caddy
    # ... keep existing depends_on for services
```

### 4e. Deploy and verify

```bash
ssh jkrumm@homelab.jkrumm.com "cd ~/homelab && git pull && op run --env-file=.env.tpl -- docker compose up -d"
```

Verify all public services still work via `*.jkrumm.com` (through Cloudflare).

---

## Phase 5: Move private services to Tailscale-only ✅ DONE

### 5a. Add Cloudflare DNS records for private services and machine access

In **Cloudflare DNS** for `jkrumm.com`:

**Machine access records** (for SSH, Samba, general Tailscale access):

| Type | Name       | Content                     | Proxy           | TTL  |
| ---- | ---------- | --------------------------- | --------------- | ---- |
| A    | ts-homelab | `100.x.y.z` (HomeLab TS IP) | DNS only (grey) | Auto |
| A    | ts-vps     | `100.x.y.z` (VPS TS IP)     | DNS only (grey) | Auto |

> `ts-homelab.jkrumm.com` gives a memorable, Tailscale-only hostname for your HomeLab. Can't reuse `homelab.jkrumm.com` since that's the IPv6 DDNS record (keep as SSH fallback).

**Service records** (for private services via Caddy):

| Type | Name      | Content                     | Proxy           | TTL  |
| ---- | --------- | --------------------------- | --------------- | ---- |
| A    | beszel    | `100.x.y.z` (HomeLab TS IP) | DNS only (grey) | Auto |
| A    | dozzle    | `100.x.y.z`                 | DNS only (grey) | Auto |
| A    | files     | `100.x.y.z`                 | DNS only (grey) | Auto |
| A    | calibre   | `100.x.y.z`                 | DNS only (grey) | Auto |
| A    | books     | `100.x.y.z`                 | DNS only (grey) | Auto |

These IPs are in the 100.64.0.0/10 CGNAT range - unreachable from the public internet. Only Tailscale devices can connect.

### 5b. Update Cloudflare DNS proxy settings

The public/private distinction is controlled entirely by the **Cloudflare DNS proxy setting** (orange vs grey cloud):

- **Orange cloud (proxied)** → traffic goes through Cloudflare CDN → tunnel → Caddy (public)
- **Grey cloud (DNS-only)** → DNS resolves to Tailscale IP → direct to Caddy (private)

For services with existing Cloudflare DNS records (beszel, dozzle, files): switch them from orange cloud to grey cloud and update the target IP to the HomeLab Tailscale IP.

For `calibre.jkrumm.com` and `books.jkrumm.com` (may be new records): create as grey cloud A records pointing to Tailscale IP.

If using individual tunnel routes (not catch-all), also remove the tunnel hostname entries for private services in the Zero Trust dashboard.

### 5c. Verify private access

From MacBook (on Tailscale):

```bash
curl -v https://beszel.jkrumm.com    # Should work via Tailscale
curl -v https://dozzle.jkrumm.com    # Should work via Tailscale
```

From a non-Tailscale device: these domains should be unreachable (timeout, since 100.x.y.z is not routable).

Test on iPhone (Tailscale enabled): open `https://beszel.jkrumm.com` in browser.

---

## Phase 6: VPS - Expand Caddy + Tailscale access ✅ DONE

The VPS already has Caddy and Tailscale (from Phase 1). Minimal changes needed.

### 6a. Expand VPS Caddyfile

**File:** `~/sideproject-docker-stack/Caddyfile`

Use the same custom Caddy image with Cloudflare DNS plugin. Update Dockerfile and Caddyfile:

```caddyfile
{
	acme_dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	auto_https disable_redirects
}

# Photos (existing)
photos.jkrumm.com {
	root * /var/www/photos
	file_server
}

# FPP
fpp.jkrumm.com {
	reverse_proxy fpp-server:3003
}

# FPP Analytics
analytics.jkrumm.com {
	reverse_proxy fpp-analytics:5100
}

# Snow Finder
snow.jkrumm.com {
	reverse_proxy snow-finder:8000
}

# Email API
email.jkrumm.com {
	reverse_proxy bun-email-api:3010
}
```

(Adjust domain names to match what's actually configured in Cloudflare.)

### 6b. MariaDB port - KEEP as-is

MariaDB on port `33306` must stay open - the FPP Next.js app on Vercel connects directly to it. Vercel is not on our tailnet, so this port cannot be Tailscale-only. Consider adding UFW/iptables rules to restrict to Vercel's IP ranges later.

### 6c. Update Cloudflare tunnel on VPS

Same pattern: route VPS tunnel hostnames to `http://caddy:80`.

### 6d. Add CLOUDFLARE_API_TOKEN to VPS 1Password

Add the token to VPS 1Password config if not already there.

---

## Phase 7: Cross-machine connections via Tailscale ✅ DONE

Both Dozzle (log scraping) and Beszel (infra metrics) on HomeLab connect to agents running on the VPS. These connections now route through the Tailscale mesh network instead of the public internet.

### 7a. Dozzle hub (HomeLab) → Dozzle agent (VPS)

Currently in HomeLab `docker-compose.yml`:

```yaml
DOZZLE_REMOTE_AGENT: ${SIDEPROJECT_DOCKER_STACK_IP}:7007 # public VPS IP
```

**Docker DNS caveat:** Dozzle runs on a Docker bridge network and cannot resolve MagicDNS names (`vps.dinosaur-sole.ts.net`) because Docker uses its own DNS resolver. Two options:

**Option A (recommended): Use raw Tailscale IP in 1Password:**
Replace `SIDEPROJECT_DOCKER_STACK_IP` in 1Password with the VPS Tailscale IP (`100.x.y.z`). No docker-compose change needed - the env var already works.

**Option B: Add MagicDNS to Dozzle container:**

```yaml
dozzle:
  dns:
    - 100.100.100.100 # Tailscale MagicDNS resolver
    - 1.1.1.1 # fallback
  environment:
    DOZZLE_REMOTE_AGENT: vps.dinosaur-sole.ts.net:7007
```

**IP routing works regardless** - Docker containers CAN route to Tailscale IPs via the host's routing table. Only DNS resolution is the issue.

### 7b. Beszel hub (HomeLab) → Beszel agent (VPS)

VPS Beszel agent currently connects outbound to the hub:

```yaml
HUB_URL: https://beszel.jkrumm.dev # currently public URL
```

Change to Tailscale-routed URL:

```yaml
HUB_URL: https://beszel.jkrumm.com # resolves to HomeLab Tailscale IP
```

This works because the VPS has Tailscale installed natively, so `beszel.jkrumm.com` (pointing to HomeLab's 100.x.y.z) is reachable from the VPS Beszel agent running in host network mode.

### 7c. Restrict agent ports to Tailscale ✅ MOSTLY DONE

**Done (via Docker port binding):**

- VPS dozzle-agent: `<tailscale-ip-sds>:7007:7007` (Tailscale IP only)
- HomeLab beszel-agent: `<tailscale-ip-homelab>:45876:45876` (Tailscale IP only)

**Remaining (needs interactive sudo for UFW):**

- VPS beszel-agent runs with `network_mode: host` — can't restrict via Docker port binding. Needs UFW:

```bash
ssh -t vps "sudo ufw allow from 100.64.0.0/10 to any port 45876 proto tcp && sudo ufw deny 45876/tcp"
```

---

## Phase 8: SSH config + Zed remote development

### 8a. Create SSH config

**File:** `~/.ssh/config` (MacBook)

```
# Primary: Tailscale (encrypted mesh, no port exposure)
Host homelab
    HostName ts-homelab.jkrumm.com
    User jkrumm

Host vps
    HostName ts-vps.jkrumm.com
    User jkrumm

# Fallback: Direct (if Tailscale is down)
Host homelab-direct
    HostName homelab.jkrumm.com
    User jkrumm

Host vps-direct
    HostName 5.75.178.196
    User jkrumm
```

> Uses `ts-homelab.jkrumm.com` / `ts-vps.jkrumm.com` (DNS-only A records → Tailscale IPs) for clean, memorable hostnames. MagicDNS names (`homelab.dinosaur-sole.ts.net`) also work as alternative.

### 8b. Update .zshrc aliases

**File:** `~/.zshrc` (MacBook)

```bash
# Replace old aliases
alias homelab="ssh homelab"
alias vps="ssh vps"
```

### 8c. Zed IDE remote development

Zed supports SSH remote development. With Tailscale SSH:

- Open Zed → `Open Remote` → select `homelab` or `vps`
- Edit `~/homelab/` and `~/sideproject-docker-stack/` directly on the servers
- Git operations (commit, push) happen on the server
- Docker compose operations happen on the server (no more push → pull workflow)

### 8d. Remove local repos

After verifying Zed remote works:

```bash
# Archive or remove local copies
rm -rf ~/SourceRoot/homelab
rm -rf ~/SourceRoot/sideproject-docker-stack
```

---

## Phase 9: Document the journey in the homelab repo ✅ DONE

### 9a. Create migration documentation

**File:** `~/homelab/docs/tailscale-migration.md`

Document the plan, decisions, and step-by-step migration journey:

- Why: what problems this solves (public admin services, SSH exposure, complex jump host routing)
- Architecture diagrams: before and after
- Decision log: why Caddy over sidecars, why own domain over .ts.net, service classification rationale
- Step-by-step log of what was done in each phase (fill in as we go)
- Issues encountered and how they were resolved

### 9b. Update project documentation with final state

**Files to update:**

- `~/homelab/CLAUDE.md` - SSH patterns (Tailscale hostnames), service URLs, workflow (direct edit vs push/pull), Caddy as reverse proxy
- `~/homelab/README.md` - Connection methods, service access URLs, Caddy config docs, Tailscale setup section
- `~/sideproject-docker-stack/README.md` - Updated access patterns, Caddy routing docs
- `~/.claude/CLAUDE.md` - Update SSH aliases section

### Key documentation changes:

- SSH: `ssh homelab` now uses Tailscale (no jump host needed for IPv4!)
- Private services: `https://beszel.jkrumm.com` (Tailscale) instead of public Cloudflare URL
- Public services: still `*.jkrumm.com` via Cloudflare, but now routed through Caddy
- Caddyfile: document as config-as-code routing reference
- Workflow: Edit directly on server via Zed → commit → `op run --env-file=.env.tpl -- docker compose up -d`
- No more "edit locally, push, pull on server" pattern
- Samba tunnel: `ssh -L 1445:localhost:445 homelab` (simpler, no jump host needed)
- Service table updated with access method (Cloudflare vs Tailscale) for each service

---

## New Files Summary

| File                          | Machine | Purpose                                                                 |
| ----------------------------- | ------- | ----------------------------------------------------------------------- |
| `caddy/Dockerfile`            | HomeLab | Custom Caddy with cloudflare DNS plugin                                 |
| `Caddyfile`                   | HomeLab | Routing config-as-code (new file)                                       |
| `caddy/Dockerfile`            | VPS     | Custom Caddy with cloudflare DNS plugin (replace plain `caddy:2` image) |
| `docs/tailscale-migration.md` | HomeLab | Migration journey documentation                                         |

## Modified Files Summary

| File                 | Machine | Changes                                                    |
| -------------------- | ------- | ---------------------------------------------------------- |
| `docker-compose.yml` | HomeLab | Add caddy service, caddy volumes, update cloudflared       |
| `docker-compose.yml` | VPS     | Custom caddy build, update agent env vars (Tailscale URLs) |
| `Caddyfile`          | VPS     | Expand from photos-only to all services                    |
| `~/.ssh/config`      | MacBook | Create with Tailscale hostnames                            |
| `~/.zshrc`           | MacBook | Update aliases                                             |

## New 1Password Secrets

| Secret                 | Machine | Purpose                                      |
| ---------------------- | ------- | -------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` | HomeLab | Used for Caddy DNS-01 challenge              |
| `CLOUDFLARE_API_TOKEN` | VPS     | Needs to be added for Caddy DNS-01 challenge |

---

## Verification Checklist

After each phase, verify before moving to the next:

### Phase 1-2 (Tailscale native) ✅

- [x] ACL tags configured in admin console before install (grants format, not acls)
- [x] `tailscale status` shows both machines + MacBook + iPhone (4 devices total)
- [x] `tailscale ping homelab` from MacBook works (via DERP(nue), ~130ms)
- [x] `ssh homelab` and `ssh vps` work via Tailscale IPs (~/.ssh/config)
- [x] All 26 HomeLab containers still running (Tailscale doesn't interfere with cloudflared)

### Phase 3-4 (Caddy on HomeLab) ✅

- [x] Caddy container starts, gets TLS cert for all 12 domains (Let's Encrypt via DNS-01)
- [x] `https://glance.jkrumm.com` works through Cloudflare (public)
- [x] `https://glance.jkrumm.com` works via Tailscale IP directly (HTTPS :443)
- [x] All public services accessible via Cloudflare → Caddy → container
- [x] HTTP (:80) and HTTPS (:443) both working (needed `http://` variants in Caddyfile)
- [x] All tunnel routes updated to `http://caddy:80` via Cloudflare API
- [x] CF Access policies removed (Tailscale replaces CF Access for private services)

> **Learning:** Caddy site blocks with domain names default to HTTPS-only. `auto_https disable_redirects` removes HTTP→HTTPS redirects but does NOT add HTTP serving. Must explicitly add `http://domain.com` variants in each site block for cloudflared to connect via port 80.

> **Learning:** `cloudflared login` stores an Argo Tunnel Token in `~/.cloudflared/cert.pem` that contains a Cloudflare API token (base64-encoded JSON with `apiToken` field). This token has broader permissions than a scoped DNS API token and can manage tunnel configurations via the `/cfd_tunnel/{id}/configurations` API endpoint.

### Phase 5 (Private services) ✅

- [x] 7 private service DNS records changed from CNAME (proxied/CF tunnel) to A (DNS-only/<tailscale-ip-homelab>)
- [x] `https://beszel.jkrumm.com` works from MacBook (Tailscale on) — 302
- [x] Private services unreachable from non-Tailscale (100.x.y.z in CGNAT range)
- [x] `https://dozzle.jkrumm.com` works — 302
- [x] All public services still work normally
- [x] Private services removed from CF tunnel config (only 5 public routes remain)
- [x] `ts-homelab.jkrumm.com` and `ts-vps.jkrumm.com` DNS-only A records created

### Phase 6 (VPS Caddy)

- [x] Custom Caddy with CF DNS plugin built on VPS (ARM64)
- [x] All 6 TLS certs obtained via DNS-01 challenge
- [x] All VPS tunnel routes updated to `http://caddy:80`
- [x] `CLOUDFLARE_API_TOKEN` added to VPS 1Password
- [x] VPS services accessible via Cloudflare tunnel → Caddy
- [x] VPS services accessible via Tailscale HTTPS directly
- [x] cloudflared depends_on cleaned (just caddy)
- [x] `bun-email-api` has pre-existing crash (Module not found) — unrelated

### Phase 7 (Cross-machine)

- [x] Dozzle hub connected to VPS agent via Tailscale (`clients:2`)
- [x] Beszel agent on VPS connects to hub via Tailscale (`beszel.jkrumm.com`)
- [x] VPS dozzle-agent port bound to Tailscale IP only
- [x] HomeLab beszel-agent port bound to Tailscale IP only
- [x] VPS beszel-agent: UFW rule to restrict port 45876 to Tailscale (done in Phase 11a)

### Phase 8 (Dev workflow)

- [x] `ssh homelab` / `ssh vps` use Tailscale (done early, ~/.ssh/config + ~/.zshrc updated)
- [ ] Zed remote development works on both machines
- [ ] Can edit docker-compose.yml and run `docker compose up -d` from Zed terminal

---

## Phase 10: Tailscale-Aware Watchdog + Cleanup ✅ DONE

Post-migration hardening.

### 10a. Add Tailscale health check to watchdog ✅ DONE

Added `check_tailscale_health()` with inline recovery to the watchdog:

- **Simple check:** `systemctl is-active tailscaled` + `tailscale status` exit code with 5s retry
- **Inline recovery:** Handled inside `perform_health_checks()`, not in the Docker/network escalation pipeline
- **No Docker interaction:** Tailscale failures don't affect overall health check result or escalation state
- **State file:** `/var/lib/homelab_watchdog/tailscale_failing` prevents notification spam (notify once on failure, once on recovery)
- **Decision resolved:** Tailscale failure → just restart tailscaled (containers are fine)

### 10b. Clean up cloudflared depends_on ✅ DONE

Removed private services from cloudflared's `depends_on`. Now only depends on caddy + public services (glance, uptime-kuma, immich-server, excalidash-frontend, dufs).

### 10c. Remove unnecessary host port bindings ✅ DONE

Removed host port bindings from private services (beszel, dozzle, filebrowser, calibre, calibre-web). All route through Caddy on the Docker network. Kept `beszel-agent:45876` (direct IP:port access).

### 10d. Fix Samba glance label ✅ DONE

Changed `glance.url` from `https://samba.jkrumm.com` (nonexistent) to `https://files.jkrumm.com` (FileBrowser).

---

## Phase 11: SSH Hardening + Firewall Tightening ✅ DONE

Close public SSH access and tighten firewall rules now that Tailscale provides secure access.

### 11a. VPS Security Hardening ✅ DONE (2026-02-07)

Full VPS hardening completed:

**Hetzner Cloud Firewall** — reduced to 2 rules:

| Rule    | Port      | Source        |
| ------- | --------- | ------------- |
| HTTPS   | TCP 443   | Any IPv4/IPv6 |
| MariaDB | TCP 33306 | Any IPv4/IPv6 |

SSH rule removed. Emergency access via Hetzner web console.

**VPS setup.sh** — created in sideproject-docker-stack repo:

- Auto-fixes Hetzner ARM64 apt mirror (`mirror.hetzner.com` → `ports.ubuntu.com`)
- SSH hardening drop-in (`/etc/ssh/sshd_config.d/99-hardening.conf`): PermitRootLogin no, PasswordAuth no, MaxAuthTries 3, X11/Agent/TcpForwarding disabled
- UFW: SSH+Beszel(45876) from Tailscale only, HTTPS+MariaDB open, deny all else
- fail2ban enabled (sshd jail)
- sysctl hardening (`/etc/sysctl.d/99-hardening.conf`): kptr_restrict=2, dmesg_restrict=1, ptrace_scope=2, rp_filter=1, log_martians=1, send_redirects=0, unprivileged_bpf_disabled=1
- unattended-upgrades: Docker packages blacklisted, auto-reboot at 4 AM

**Package upgrades:**

- Kernel: 5.15.0-102 → 5.15.0-168 (rebooted after 657 days)
- Docker 29.2.1, containerd 2.2.1, runc 1.3.4, Compose 5.0.2
- Tailscale 1.94.1, 1Password 3.75.2

**Docker Compose hardening:**

- `security_opt: [no-new-privileges:true]` on all containers (except beszel-agent: network_mode host)
- `mem_limit`: MariaDB 2G, fpp-analytics 1G
- Log rotation: MariaDB (50m/3), fpp-analytics-updater (20m/3)

**Verified:** `ssh vps-direct` times out (Hetzner FW blocks), `ssh vps` works (Tailscale).

### 11b. HomeLab SSH hardening + UFW ✅ DONE (2026-02-07)

**SSH hardening** — drop-in at `/etc/ssh/sshd_config.d/99-hardening.conf`:

- PermitRootLogin no, PasswordAuthentication no, MaxAuthTries 3
- X11/Agent/TcpForwarding disabled, ClientAliveInterval 300/CountMax 2
- Removed `50-cloud-init.conf` (was overriding PasswordAuthentication to yes)

**UFW** — Tailscale-aware rules:

- SSH (22): allow from 100.64.0.0/10 only, deny all else
- Samba (139, 445): allow from 100.64.0.0/10 only, deny all else
- Default: deny incoming, allow outgoing

**sysctl hardening** — `/etc/sysctl.d/99-hardening.conf`:

- Same as VPS: kptr_restrict=2, dmesg_restrict=1, ptrace_scope=2, rp_filter=1, log_martians=1, send_redirects=0, unprivileged_bpf_disabled=1

**unattended-upgrades** — Docker packages blacklisted, auto-reboot at 4 AM

**setup.sh updated** — now includes SSH hardening, sysctl, unattended-upgrades (parity with VPS setup.sh)

**Verified:** `ssh homelab` works (Tailscale), `ssh homelab-direct` blocked (No route to host), all 27 containers running.

### 11c. Verification ✅ DONE (2026-02-07)

All checks passed:

- `ssh homelab` / `ssh vps` work via Tailscale
- `ssh homelab-direct` → "No route to host" (UFW blocks)
- `ssh vps-direct` → timeout (Hetzner FW blocks)
- UFW active on both machines with Tailscale-only SSH/Samba rules
- All containers running on both machines

---

## Risk Mitigation

- **Cloudflare stays running throughout** - zero disruption to public services
- **Phase by phase** - each phase is independently valuable and reversible
- **HomeLab is remote** - test one service at a time, always verify before proceeding
- **Rollback per service**: Switch DNS record back to orange cloud (proxied) to restore Cloudflare access
- **Rollback Caddy**: If Caddy fails, revert cloudflared to route directly to containers (current setup)
- **SSH fallback**: Keep `homelab.jkrumm.com` (IPv6) and `5.75.178.196` (IPv4) as backup SSH access until Tailscale is proven stable
