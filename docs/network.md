# Network topology and Docker socket security

**Full service table (public/private/internal, URLs, ports): README → Service Access
Cheatsheet.** This file carries the operating facts an agent needs beyond that table.

## Network topology

```
Public:  Internet → Cloudflare CDN (orange cloud) → CF Tunnel → cloudflared → http://caddy:80 → container
Private: Tailscale device → HomeLab TS IP (<tailscale-ip-homelab>) → https://caddy:443 → container
```

**Caddy is the single routing layer** — the `Caddyfile` is the source of truth for all
service routing. Each site block has both an `https://` (Tailscale) and an `http://`
(cloudflared) variant — Caddy defaults new site blocks to HTTPS-only, so the `http://`
variant needs adding explicitly. The global `auto_https disable_redirects` setting keeps
HTTPS cert provisioning working while dropping the HTTP→HTTPS redirect that would
otherwise 301 cloudflared's plain-HTTP connection. TLS comes from Let's Encrypt via the
Cloudflare DNS-01 challenge (`caddy-dns/cloudflare`, baked into the prebuilt
`caddybuilds/caddy-cloudflare` image — there is no `caddy/Dockerfile` in this repo).
Private-service DNS is a grey-cloud (DNS-only) Cloudflare A record pointing at the
HomeLab Tailscale IP. Full rationale: `docs/decisions.md`.

8 Docker bridge networks (`docker-compose.yml` → `networks:`): `cloudflared`,
`beszel`, `socket-proxy`, `socket-proxy-watchtower`, `socket-proxy-claude`,
`watchtower-egress`, `proton-bridge`, `karakeep-internal`.

**Tailnet:** `dinosaur-sole.ts.net`. Device IPs are placeholders in every tracked file —
resolve the real ones via `tailscale status` or the admin console, never hardcode them here.

## Docker socket security

Monitoring services (Glance, Dozzle, Beszel-Agent, UptimeKuma) access Docker via
`docker-socket-proxy` (`tcp://docker-socket-proxy:2375`) instead of a direct socket mount —
read-only (CONTAINERS, IMAGES, INFO, NETWORKS, VOLUMES; POST/BUILD/EXEC blocked), on an
internal network with no external access. **Exceptions:** Watchtower gets a dedicated
`docker-socket-proxy-watchtower` (POST=1, DELETE=1) on its own isolated network; argo
(on the Mac mini since 2026-10-30) reads container state through `docker-socket-proxy-claude`, bound to the HomeLab
Tailscale IP on `:2376` (read-only, same restrictions; tailnet grant `tag:devhost -> tag:homelab`).
