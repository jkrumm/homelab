# Decisions & Rationale

Durable "why" narratives pulled out of CLAUDE.md to keep it dense. Read on demand.

## Build-cache pruning (locally-built services)

**garmin-collector and image-share are the only locally-built services** (Watchtower can't auto-update them). After code changes use `make garmin-deploy`/`make garmin-rebuild` or `make image-share-deploy` — all use `--no-cache`.

**`--no-cache` on every build is why the disk fills, so every build target self-prunes.**
Each rebuild leaves a whole build-cache layer set plus a dangling image; unbounded that
reached **108 GB of build cache (2552 entries) and 350 dangling images** by 2026-08 —
more disk than every photo on the box. `$(PRUNE)` is appended to `garmin-deploy`,
`garmin-rebuild` and `image-share-deploy`, so the garbage is collected by whoever makes
it. Two deliberate choices in it:

- **Bounded, not zeroed** (`--max-used-space 10GB`). Both Dockerfiles use
  `--mount=type=cache` for their pip/bun package caches, and those mounts live *in* the
  build cache — an uncapped `builder prune -a` deletes them too, so the next build
  recompiles the C extensions from source, which is the exact thing those mounts exist
  to avoid. Docker 29's flag is `--max-used-space`; `--keep-storage` is gone.
- **`image prune -f`, never `-a`.** Dangling-only. A tagged image is never touched,
  because some pinned tags no longer resolve upstream and the local copy is the only one
  left — see the karakeep-chrome migration in `.claude/skills/upgrade-stack/SKILL.md`.

**What no prune target can reach:** images of *decommissioned* services stay tagged
forever (obsidian, calibre, librechat, mongo… ~25 GB as of 2026-08-27). Removing one is
a deliberate `docker rmi <tag>` after confirming it is in neither compose file. Careful
with the check — a locally-built image is referenced by the container as
`homelab-image-share`, not `homelab-image-share:latest`, so a naive exact-match grep
reports it as orphaned when it is live.

## Wiring a new Uptime Kuma push monitor — fully agentic

**Wiring a new push monitor is fully agentic — no browser, no biometric, no human.** Done end to end for `Image Share Reverse-Backup - Push` (id=219) on 2026-08-07. Two facts make it so, and both contradict what this repo used to assume:

- **`make uk-sync` creates push monitors declaratively and the `pushToken` is readable in the same session** — `api.get_monitor(<id>)["pushToken"]`, via the snippet in the global CLAUDE.md. Only `active` is genuinely unsupported for push monitors.
- **HomeLab's 1Password credential is a *service account* with write access to the `homelab` vault** — `op item create` / `op item edit` both work non-interactively over ssh. So the field can be written from an agent; it is *not* biometric-gated like `op://Private/*` on the Macs. (`op` over ssh needs `< /dev/null`, otherwise it tries to parse stdin as JSON and dies with `invalid JSON in piped input`.)

Match the item's existing convention when writing: on `homelab/image-share`, secrets are `CONCEALED`, so a push URL goes in as `KUMA_PUSH_URL[concealed]=…`.

**The one hard ordering constraint: the 1Password field must exist BEFORE the `op://` ref lands on the server.** `OP := op run --env-file=.env.tpl --` wraps *every* target here, `op run` exits 1 on an unresolvable ref, and `uk-sync` git-pulls before it runs — so a ref to a missing field bricks `deploy`, `up`, `restart`, `uk-sync` and both image-share targets at once, with no way left to create the monitor that mints the token. The safe sequence is: ship the `.env.tpl` line **commented out** → `make uk-sync` → read the `pushToken` → write the field → uncomment → `make image-share-restart`. Commenting out is not caution for its own sake: unset, compose expands the var to empty and image-share's `env.ts` defaults it to `''`, so the service stays healthy with the heartbeat dormant.

## Garmin MFA re-login automation

**Automated MFA re-login.** Garmin invalidates the refresh token every ~1-2 weeks; re-auth then needs an emailed 6-digit MFA code. `scripts/garmin-auto-relogin.sh` automates it end-to-end: `relogin_auto.py` (a `docker compose run` sibling) triggers a fresh login and fetches the code from the "Ihr Sicherheitscode" email via argo's Gmail endpoint (`ARGO_API_TOKEN` = `op://common/api/SECRET`), stashing/restoring the current token so a failed run never leaves the collector token-less. The wrapper is **hybrid**: proactive (refresh every 4d, before the token can expire → container stays healthy, no UptimeKuma/watchdog noise) + reactive (if already unhealthy, reauth within ~2h, but ≥6h between attempts so a Garmin 429 can't storm). A homelab crontab entry runs it every 2h; `make garmin-relogin-auto` forces a run. The UptimeKuma "Garmin Collector - Push" interval is widened to 12h so this auto-recovery heals silently before paging. `make garmin-relogin` (interactive, MFA from phone/email) remains the manual fallback.

## Tailscale + Caddy — durable insights from the 2026-02 migration

The phase-by-phase migration plan (`docs/TAILSCALE.md`) shipped and was deleted once every
phase landed; these three decisions are the parts worth keeping:

- **Dual HTTP/HTTPS Caddy.** Caddy serves both `http://` (port 80, for cloudflared) and
  `https://` (port 443, for Tailscale) variants of every site block. The global
  `auto_https disable_redirects` setting keeps HTTPS cert provisioning working but removes
  the HTTP→HTTPS redirect, so cloudflared can connect via `http://caddy:80` without a 301.
  Caddy site blocks default to HTTPS-only, so the `http://` variant must be added
  explicitly per block — it is not implied by disabling the redirect.
- **Grey-cloud A records for private services.** DNS for Tailscale-only services (Beszel,
  Dozzle, FileBrowser, Garmin Collector, Karakeep) is a Cloudflare A record in DNS-only
  mode (grey cloud) pointing at the HomeLab Tailscale IP — unreachable from the public
  internet, resolves instantly for any Tailscale device.
- **DNS-01 for TLS.** Caddy obtains Let's Encrypt certs via the Cloudflare DNS-01 challenge
  (`caddy-dns/cloudflare` plugin baked into the `caddybuilds/caddy-cloudflare` image), which
  works even for hostnames that only resolve to a private Tailscale IP — no port-80 HTTP-01
  challenge needed.
