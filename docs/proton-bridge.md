# Proton Mail Bridge (headless IMAP for hello@)

`proton-bridge` exposes the Proton mailbox as IMAP so `bun-email-api` (VPS, `proxy`
docker network) can read it. Proton has no public API; Bridge is the official way in.

| | |
|-|-|
| Service | `proton-bridge` in `docker-compose.yml`, built from `packages/proton-bridge/` |
| Endpoint | IMAP `${HOMELAB_TAILSCALE_IP}:1143` (STARTTLS, self-signed Bridge cert). **No SMTP** (sending stays on Resend), no Caddy entry, no tunnel |
| State | `/home/jkrumm/ssd/proton-bridge` → `/data` (`HOME`): vault, gpg keyring, pass store |
| Backup | restic source `/sources/ProtonBridge`; gluon message cache + logs excluded (re-synced from Proton) |
| Secrets | `op://common/proton-bridge/IMAP_USER`, `IMAP_PASSWORD` (VPS service account reads `common`) |

## Why a local Dockerfile, not a community image

The container holds decrypted access to the whole Proton account (bank mail included).
`shenxn/protonmail-bridge-docker` and `VideoCurio/ProtonMailBridgeDocker` are
unofficial and lag releases, so they add a supply-chain hop for no gain. The Dockerfile
installs Proton's **official `.deb`** pinned to one version and verifies it twice:

1. SHA-256 of the `.deb` (same value in Proton's PKGBUILD and the GitHub release asset list);
2. `debsig-verify` against Proton's signing key `D51E64D3E63EDC3EEF7864CEE2C75D68E6234B07`,
   which is itself pinned by SHA-256 of `bridge_pubkey.gpg` **and** by full fingerprint.

Keychain is `pass` + a passphrase-less gpg key generated on first boot (Bridge selects
`pass` automatically when present). Bridge only ever listens on `127.0.0.1:1143` inside
the container, so an in-container `socat` relays `0.0.0.0:143` → it; compose publishes
that on the Tailscale IP only. **Upgrade:** bump `BRIDGE_VERSION` + `BRIDGE_DEB_SHA256`
in the Dockerfile (Watchtower does not touch it), then `make proton-bridge-deploy`.

## First-time login (interactive — Proton password + 2FA cannot be automated)

```bash
make proton-bridge-login     # stops the daemon, opens the Bridge CLI, restarts the daemon after `exit`
```

In the `>>>` prompt:

1. `login` — Proton username, password, 2FA code (and mailbox password if two-password mode).
2. `change mode 0` — **toggles** combined ↔ split addresses (no target argument; answer `yes`).
   Confirm it printed `changed to split`; run it again if it says `combined`. Split mode
   gives each address (incl. `hello@`) its own IMAP credentials.
3. `info 0` — prints IMAP address/port and, per address, the username and the generated
   Bridge password. Take the **`hello@`** entry.
4. `exit`.

Store the credentials (on the MacBook, biometric `op`):

```bash
op item create --account tkrumm --vault common --category login --title proton-bridge \
  IMAP_USER=<hello@ username from info> IMAP_PASSWORD=<hello@ bridge password from info>
```

Re-login is only needed if the vault is lost/restored without the gpg keyring, or Proton
revokes the session. The Bridge password is not the Proton password and rotates only on
re-login / mode change.

## Tailnet ACL prerequisite

The VPS → homelab grant in `dotfiles-private/tailscale-acl.jsonc` must include `tcp:1143`
(it started as `tcp:443`, `tcp:2376`); without it the VPS times out on the port. Apply via
`make tailscale-acl-diff` / `tailscale-acl-push` in the `dotfiles` repo (MacBook-only).

## Operate

| | |
|-|-|
| `make proton-bridge-deploy` | pull + rebuild (no cache) + up |
| `make proton-bridge-restart` / `-logs` | restart / follow logs |
| Client settings | host `${HOMELAB_TAILSCALE_IP}` (tailnet), port 1143, STARTTLS, self-signed cert → client must skip verification or trust it; user/password from 1Password |

Backup restore: restore `/sources/ProtonBridge` (vault + `.gnupg` + `.password-store` must
come back **together**), start the container; Bridge re-syncs the message cache.
