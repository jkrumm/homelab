# Decisions & Rationale

Durable "why" narratives pulled out of AGENTS.md to keep it dense. Read on demand.

## 1Password CLI in cron shells

**Every `op`-wrapped cron line must source a profile first.** A cron command runs under a
non-login `sh` (dash here) that reads neither `.profile` nor `.bashrc`, so on its own it
carries no `OP_SERVICE_ACCOUNT_TOKEN`:

```cron
*/10 * * * * [ -r /root/.profile ] && . /root/.profile; /home/jkrumm/homelab/scripts/homelab_watchdog.sh >> /var/log/homelab_watchdog.log 2>&1
```

The `[ -r ]` guard is load-bearing, not decoration. `.` is a POSIX *special builtin*, so
dash aborts the **entire command line** when the file it names cannot be opened — verified
on the dev host 2026-09-21, `dash -c '. /nonexistent; echo REACHED'` prints nothing and
exits 2, while the `[ -r ]`-guarded form reaches the next command with a missing, present
or unreadable file. Unguarded, one absent profile costs every run of the entry, not just
the credential it was meant to supply.

**The token lives in `~jkrumm/.profile`, outside the `BASH_VERSION` guard** — dash skips
the guard body, and a `.bashrc` copy only serves interactive shells. Root's entry is the
one that is easy to miss: it needs the same export in `/root/.profile`, and **nothing in
this repo writes that file**. `setup.sh` creates it when absent, keeps it `0600`, and
reports `Watchdog credentials: NOT CONFIGURED` in its closing summary when the export is
still missing — but the value is a secret an operator pastes in by hand. That gap is what
makes the failure silent: without the token `load_credentials()` exits 1, and the watchdog
cannot alert about it, because its Slack webhook is itself read through `op`.

The rule covers every op-wrapped cron entry, not just the watchdog's, which is why it
lives here rather than in the watchdog's own doc.

**Verify the credential, don't grep for it.** The only check that proves root's *cron*
shell reaches 1Password reproduces that shell instead of approximating it:

```bash
sudo env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin sh -c '. /root/.profile && op whoami'
```

`setup.sh` runs the same command (as `ROOT_OP_CHECK`) from its closing summary, so the
`Watchdog credentials:` line is an authentication, not a match on the export line — a
token that is present, expired or revoked passes a grep and still leaves the watchdog
exiting 1. Each part of the shape is load-bearing. `env -i` drops the invoking
environment, without which an `OP_SERVICE_ACCOUNT_TOKEN` already exported in the
operator's shell makes `op whoami` succeed against *their* token; `PATH` is then passed
explicitly, because `env -i` clears it and the apt package's `op` lives at `/usr/bin/op`
— omit it and the check fails closed on a correctly configured host. Sourcing the
profile under `sh` rather than bash is the last piece: it is what cron does, so a token
parked behind the `BASH_VERSION` guard that a stock `.profile` puts there fails here too,
instead of passing and hiding the outage. `sudo -i` alone is not this check — it only
opens a shell, so a following `op whoami` runs in the shell that typed it, authenticating
the wrong token and reporting the failure as success.

## Build-cache pruning (locally-built services)

**proton-bridge is the locally-built service** (Watchtower can't auto-update it). After code changes use `make proton-bridge-deploy`, which uses `--no-cache`. (image-share and garmin-collector were the others until they were decommissioned, see the end of this file.)

**`--no-cache` on every build is why the disk fills, so every build target self-prunes.**
Each rebuild leaves a whole build-cache layer set plus a dangling image; unbounded that
reached **108 GB of build cache (2552 entries) and 350 dangling images** by 2026-08 —
more disk than every photo on the box. `$(PRUNE)` is appended to
`proton-bridge-deploy` and every other build target, so the garbage is collected by whoever
makes it. Two deliberate choices in it:

- **Bounded, not zeroed** (`--max-used-space 10GB`). Build Dockerfiles can use
  `--mount=type=cache` for their package caches, and those mounts live *in* the
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
  Dozzle, FileBrowser, Karakeep) is a Cloudflare A record in DNS-only
  mode (grey cloud) pointing at the HomeLab Tailscale IP — unreachable from the public
  internet, resolves instantly for any Tailscale device.
- **DNS-01 for TLS.** Caddy obtains Let's Encrypt certs via the Cloudflare DNS-01 challenge
  (`caddy-dns/cloudflare` plugin baked into the `caddybuilds/caddy-cloudflare` image), which
  works even for hostnames that only resolve to a private Tailscale IP — no port-80 HTTP-01
  challenge needed.

## image-share decommissioned (2026-10-12)

The `image-share` service (share.jkrumm.com) was decommissioned; sharing moved to shutterflow. Its compose service, Caddy site block, `IMAGE_SHARE_*` secret refs, `make image-share-*` targets and the "Image Share" Uptime Kuma group are gone from this repo. The entries above that mention image-share (build-cache pruning, the push-monitor walkthrough) are kept as history of how those mechanisms were established; the `make image-share-*` targets they name no longer exist.

Data was left on disk on purpose and stays covered by restic: `~/ssd/SSD/Bilder/ImageShare`, `~/ssd/image-share`, `~/ssd/SSD/Dev/image-share` and `~/ssd/SSD/Bilder/B2-Mirror`. The daily B2 `img/` → B2-Mirror reverse-backup cron lived inside the service and died with it, so B2-Mirror no longer refreshes.

## dufs / public.jkrumm.com retired (2026-10-19)

Every file door is Tailscale-only now. dufs served `~/ssd/SSD/Public` publicly (anonymous
read, password write); its one real use, hosting README diagrams, is covered by the `/img`
CDN for public images and by presigned links (B2 `private/`, or `s3.jkrumm.com`) for
one-off shares. The compose service, Caddy block, `DUFS_PASSWORD` ref, Kuma monitors, the
tunnel ingress entry and the DNS record are gone. `~/ssd/SSD/Public` stays on disk and in
restic. Immich's host port 2283 went in the same change — Caddy and Glance reach it over
Docker networks, so the published port was only a LAN door.

## garmin-collector decommissioned (2026-10-25)

Argo now calls Garmin's official Connect Personal API directly with a personal API key, so the `garmin-collector` container is gone, and with it the password login, the MFA-by-email relogin (script, cron entry, push monitor) and the Tailscale route (`garmin.jkrumm.com`). The "Garmin Collector - Push" monitor stays under its old name: it is the heartbeat argo's garmin-sync cron pushes to, and renaming it would mint a new push URL.
