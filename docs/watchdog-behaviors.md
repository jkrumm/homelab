# Watchdog Failure Scenarios & Recovery Behaviors

This document describes how the HomeLab Watchdog behaves under various failure conditions.

---

## Overview

The watchdog (`scripts/homelab_watchdog.sh`) runs via cron every 10 minutes and provides multi-level self-healing with graduated escalation.

**Key Design Principles:**

- Graduated response (don't reboot for minor issues)
- Self-healing when possible
- Manual intervention as last resort (but auto-recoverable)
- Max 3 reboots per day (prevents reboot loops)

---

## Health Checks Performed

| Check                 | Method                                                      | Depends On       |
| --------------------- | ----------------------------------------------------------- | ---------------- |
| Mount Integrity       | `mountpoint -q /mnt/hdd` + write test + critical dirs       | Local filesystem |
| Internet Connectivity | Ping 8.8.8.8, 1.1.1.1, 9.9.9.9                              | Network          |
| External Monitor      | BetterStack API (monitor 3001641 = UptimeKuma)              | Internet         |
| Internal Monitor      | UptimeKuma status page (localhost:3010)                     | Docker           |
| Docker Health         | systemctl + key containers running                          | Docker daemon    |
| Tailscale Health      | `tailscale status` exit code + retry (independent recovery) | Tailscale        |

**Key containers checked:** `caddy`, `cloudflared`, `uptime-kuma`

**Critical HDD directories checked:** `/mnt/hdd/beszel`

---

## Network Architecture Context

The watchdog operates in a dual-routing architecture:

```
Public:  Internet → Cloudflare CDN → CF Tunnel → cloudflared → http://caddy:80 → container
Private: Tailscale device → HomeLab TS IP (<tailscale-ip-homelab>) → https://caddy:443 → container
```

**Caddy** is the single routing layer for ALL services. If Caddy dies, both public and private services are unreachable.

**Cloudflared** handles all public traffic. If it dies, only public services are affected (private Tailscale access still works).

---

## Tailscale Health Check

The watchdog monitors Tailscale connectivity to ensure private services remain accessible.

**Check method:**

1. `systemctl is-active tailscaled` — fast daemon pre-check
2. `tailscale status >/dev/null` — functional check (daemon responding, authenticated, connected)
3. Retry once after 5s pause if first attempt fails (handles transient DERP switches)

**Architecture:** Tailscale is handled **independently** from the main health check pipeline:

- Runs inline in `perform_health_checks()`, not in `analyze_failure_and_recover()`
- Does NOT affect the overall health check return value
- Does NOT interact with the Docker/network escalation state (0-4)
- Has its own state file (`/var/lib/homelab_watchdog/tailscale_failing`) to prevent notification spam

**Recovery action:** `systemctl restart tailscaled` (watchdog runs as root)

**Notification behavior:**

- First failure: restart attempted, notify only if restart fails
- Repeated failures: restart attempted each cycle, no re-notification (just logs)
- Recovery after failure: notify once ("Tailscale Restored")

**Note:** `restart_network_interface()` (Level 2 escalation) temporarily drops Tailscale when it bounces the default interface. After the interface comes back, `tailscaled` reconnects automatically.

---

## Failure Scenarios

### 1. Internet Outage (ISP Down)

**What fails:**

- `check_internet_connectivity` - can't ping external DNS
- `check_external_monitor` - can't reach BetterStack API
- UptimeKuma external HTTP monitors show DOWN

**What keeps working:**

- Docker container monitors (via docker-socket-proxy)
- UptimeKuma web UI (localhost access)
- All containers continue running
- Private Tailscale access (if ISP supports Tailscale DERP relay)

**Watchdog behavior:**

| Time            | State | Action                                          |
| --------------- | ----- | ----------------------------------------------- |
| 0-10 min        | 0→1   | Wait for natural recovery (checks every 60s)    |
| 10-20 min       | 1→2   | Continue waiting, log warnings                  |
| 20-30 min       | 2→3   | Restart network interface (won't fix ISP issue) |
| 30+ min         | 3→4   | System reboot (attempt 1)                       |
| After 3 reboots | 4     | Set `manual_intervention_required` flag         |

**Recovery:**
Once internet returns, next watchdog run detects all healthy → auto-clears flag → resumes normal operation.

**Notifications:**
Slack notifications are queued during outage, flushed when internet returns.

---

### 2. Docker Service Crash

**What fails:**

- `check_docker_health` - key containers not running
- `check_internal_monitor` - UptimeKuma may be down
- `check_external_monitor` - BetterStack detects services down

**What keeps working:**

- Internet connectivity
- Mount integrity

**Watchdog behavior:**

| State | Action                                         |
| ----- | ---------------------------------------------- |
| 0→1   | Restart Docker daemon + `docker compose up -d` |
| 1→3   | If still failing, aggressive Docker cleanup    |
| 3→4   | System reboot                                  |

**Recovery:**
Usually resolves at state 1 (simple Docker restart).

**Note on Caddy:** If only Caddy crashes, Docker health check catches it immediately (caddy is in key_containers). Docker restart brings it back with all routes intact — no config or cert loss since `caddy_data` and `caddy_config` are Docker volumes.

---

### 3. HDD Mount Failure

**What fails:**

- `check_mount_integrity` - /mnt/hdd not accessible
- Containers with HDD volumes fail to (re)start — the bare `/mnt/hdd` mountpoint is
  `chattr +i`, so Docker cannot create stand-in dirs on the SSD
  (`scripts/hdd-mountpoint-guard.sh`). Already-running ones keep their stale view: stop them.
  After the HDD is back: run the guard script (root), then `make up`.

**What keeps working:**

- SSD-based services (UptimeKuma, Immich, Karakeep)
- Caddy, cloudflared, Glance (no HDD dependency)

**Watchdog behavior:**

1. **Diagnose cause:**
   - USB device not connected → Set manual intervention (hardware issue)
   - Mapper missing, or **stale** (bound to a device node that vanished) → LUKS reopen (below)
   - I/O errors in dmesg after a failed reopen → Cautious escalation (log only), then manual intervention
   - Unknown cause → Normal escalation

2. **Recovery attempts:**
   - Mapper healthy: try `mount /mnt/hdd` up to 3 times, verify with a write test
   - Otherwise, or if remounting failed: **LUKS reopen** (`reopen_encrypted_hdd`) — stop
     Docker, unmount, `cryptsetup close`, `cryptdisks_start` (crypttab keyfile, by UUID),
     `e2fsck -p`, mount, write test, start Docker, `restore_vpn_stack`. Docker comes back
     whenever that is safe — HDD mounted, or the bare mountpoint immutable
     (an empty one is locked with `chattr +i` on the spot) — and every run starts a Docker
     it finds down and safe, so a killed reopen can't leave the host dark. The watchdog
     never deletes: if the bare mountpoint holds files, Docker stays stopped and manual
     intervention is flagged (inspect, then `hdd-mountpoint-guard.sh`). A manual
     `systemctl stop docker` is undone within 10 minutes, as before.
     One reopen per hour (`HDD_REOPEN_COOLDOWN`, successful ones included) so a flapping enclosure can't bounce Docker every run; a cooldown skip holds the escalation state, and a failed reopen never enters the reboot ladder — after 3 failures it flags manual intervention. A busy mountpoint aborts (no lazy unmount).
   - On success it logs the drive's SMART power counters — rising `Power_Cycle_Count` /
     `Power-Off_Retract_Count` mean the drive lost power; flat ones point at the USB link.

**Why the reopen exists (2026-10-27):** the enclosure dropped off USB for a second and
re-enumerated as `sdc` — the open mapper still held `sdb`, so the kernel could not reuse
the name. dm-crypt stayed bound to the vanished `sdb2`, ext4 aborted its journal and went
read-only, and the old recovery remounted the same dead mapper three times before flagging
manual intervention. Every HDD-backed service was down for ~40 minutes.

**Manual intervention required for:**

- Physical HDD disconnection (but a flagged run keeps retrying recovery, so a drive that
  comes back is reopened without a human)
- LUKS partition absent although the adapter is present
- `e2fsck -p` refusing to repair — sets `hdd_fsck_needs_human`, which blocks every automatic mount/reopen until a human runs `e2fsck -f -y` and removes it
- Persistent I/O errors (failing drive)

**SMART baseline** (ST18000NM003D, 2026-10-27, after the drop): `Power_Cycle_Count` 40,
`Power-Off_Retract_Count` 13, `UDMA_CRC_Error_Count` 0, 0 reallocated/pending sectors.

---

### 4. Cloudflare Tunnel Down (cloudflared crash)

**What fails:**

- External access to public services (glance, immich, uptime, draw, public)
- `check_external_monitor` - BetterStack sees UptimeKuma as down

**What keeps working:**

- All containers running locally
- Private Tailscale services (beszel, dozzle, etc.) — unaffected
- `check_docker_health` catches cloudflared down (it's in key_containers)
- `check_internal_monitor` passes (localhost access)

**Watchdog behavior:**

Docker health check detects cloudflared is down → restarts Docker → cloudflared comes back.

If Docker health passes but BetterStack is down → diagnosed as "monitoring discrepancy":

| State | Action                                     |
| ----- | ------------------------------------------ |
| 0→1   | Light Docker restart (restart cloudflared) |
| 2     | Network interface restart                  |
| 3+    | Escalated recovery                         |

---

### 5. Caddy Down

**What fails:**

- ALL services (both public and private) are unreachable
- `check_external_monitor` - BetterStack sees UptimeKuma as down
- `check_docker_health` catches caddy down (it's in key_containers)

**What keeps working:**

- All backend containers still running
- UptimeKuma accessible on localhost:3010 (bypasses Caddy)

**Watchdog behavior:**

Docker health check detects caddy is down → restarts Docker → caddy rebuilds from Caddyfile + cached certs.

**Recovery:** Typically resolves at state 1. Caddy restarts quickly and re-reads Caddyfile. TLS certs are cached in Docker volumes, so no re-issuance needed.

---

### 6. BetterStack API Issues

**What fails:**

- `check_external_monitor` - API unreachable or returns error

**What keeps working:**

- Everything else (this is external service issue)

**Watchdog behavior:**

Built-in retry logic: 3 attempts with exponential backoff (5s, 10s delays).

If BetterStack is genuinely down but homelab is healthy:

- `check_internal_monitor` passes
- `check_docker_health` passes
- Diagnosed as external monitoring issue, not homelab problem

---

### 7. Tailscale Down

**What fails:**

- All 7 private services unreachable from Tailscale devices
- SSH via `ssh homelab` (Tailscale IP) fails
- Cross-machine connections (Dozzle hub → VPS agent, Beszel hub → VPS agent)

**What the watchdog detects:**

- `check_tailscale_health` fails (`tailscale status` fails after retry)
- Other checks still PASS (internet, BetterStack, UptimeKuma, Docker)

**Watchdog behavior:**

| Cycle               | Action                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| 1st failure         | Restart `tailscaled`, wait 30s, recheck. Notify only if restart fails. |
| Subsequent failures | Restart `tailscaled` each cycle. Log only (no re-notification).        |
| Recovery            | Notify "Tailscale Restored" once. Clear failure state file.            |

**Key design:** Tailscale is completely independent from the Docker/network escalation state machine. No Docker restarts, no reboots, no escalation for Tailscale-only issues.

**What keeps working:**

- Public services (Cloudflare tunnel path is independent)
- All containers running normally
- Nothing private: SSH, Samba and the S3 gateway are Tailscale-only, so they go dark with
  it. There is no direct-SSH fallback (the old IPv6 `homelab.jkrumm.com` record was removed
  2026-10-20); the last resort is physical access.

---

### 8. Long Outage Recovery (Auto-Healing)

**Scenario:** ISP down for 6+ hours, triggers 3 reboots, manual intervention flag set.

**Old behavior:** Watchdog suspended indefinitely until manual SSH to clear flag.

**Current behavior (improved):**

1. Watchdog still runs every 10 minutes
2. Detects manual intervention flag
3. Runs health checks anyway
4. If all healthy → auto-clears flag → resumes normal operation
5. If still unhealthy → stays in manual intervention mode

This allows self-healing after extended outages without manual intervention.

---

## Escalation States

| State | Name      | Trigger            | Recovery Action            |
| ----- | --------- | ------------------ | -------------------------- |
| 0     | Healthy   | All checks pass    | None                       |
| 1     | Warning   | First failure      | Wait/retry, Docker restart |
| 2     | Degraded  | Persistent failure | Network interface restart  |
| 3     | Critical  | Recovery failed    | Aggressive Docker cleanup  |
| 4     | Emergency | All else failed    | System reboot (max 3/day)  |

---

## Key Configuration Values

| Variable                         | Value         | Purpose                                 |
| -------------------------------- | ------------- | --------------------------------------- |
| `INTERNET_RECOVERY_WAIT`         | 600s (10 min) | Wait for ISP to recover                 |
| `NETWORK_STABILIZE_WAIT`         | 60s           | After network interface restart         |
| `DOCKER_RESTART_WAIT`            | 120s          | After Docker daemon restart             |
| `DOCKER_COMPOSE_STABILIZE_WAIT`  | 60s           | For containers to fully start           |
| `MAX_REBOOTS_PER_DAY`            | 3             | Prevents reboot loops                   |
| `EXTERNAL_MONITOR_PATIENCE_WAIT` | 420s (7 min)  | Wait for BetterStack to detect recovery |

---

## Manual Intervention

**When it's set:**

- 3 reboots in one day
- HDD physically disconnected
- LUKS partition absent / `e2fsck -p` refused
- Persistent I/O errors

**Auto-cleared when:**

- System becomes healthy (all checks pass), or
- HDD recovery succeeds on a flagged run (the flagged branch retries it every run)

**Slack while flagged:** one "Still Unhealthy" reminder per 6h (`MANUAL_REMINDER_INTERVAL`),
not one per 10-minute run.

**Manual clear (if needed):**

```bash
ssh homelab "sudo rm /var/lib/homelab_watchdog/manual_intervention_required"
```

---

## Log Files

| File                                                     | Purpose                        |
| -------------------------------------------------------- | ------------------------------ |
| `/var/log/homelab_watchdog.log`                          | All watchdog activity          |
| `/var/lib/homelab_watchdog/state`                        | Current escalation level (0-4) |
| `/var/lib/homelab_watchdog/reboot_tracker`               | Reboot count for today         |
| `/var/lib/homelab_watchdog/notification_queue`           | Queued notifications           |
| `/var/lib/homelab_watchdog/manual_intervention_required` | Intervention flag              |

---

## Notifications

Notifications are sent via Slack webhook and grouped together at the end of each watchdog run.

**During outage:** Notifications are queued (can't reach Slack API).

**After recovery:** Queue is flushed, all notifications sent in batch.

**Notification types:**

- `🟢 System Restored` - All healthy after issues
- `🌐 Internet Down` - Network connectivity lost
- `🐳 Docker Issue` - Container problems
- `💿 HDD Disconnected` - Storage hardware issue
- `🔐 Encryption Issue` - LUKS problem
- `🚨 CRITICAL` - System reboot initiated
- `⚠️ Manual Intervention` - Automatic recovery suspended

---

## Uptime Kuma Heartbeat

The watchdog sends a heartbeat to an Uptime Kuma push monitor on every completed run.

**Purpose:** Secondary monitoring - if the watchdog itself stops running (cron failure, script crash), Uptime Kuma detects it.

**Behavior:**

- Sent on every run completion (healthy or unhealthy)
- Includes current escalation state in message
- Gracefully skips if `UPTIME_KUMA_PUSH_TOKEN` not configured

**Configuration:**

- Token read live via `op read 'op://homelab/uptime-kuma/PUSH_TOKEN'` (root's
  `OP_SERVICE_ACCOUNT_TOKEN` session, `load_credentials()`) — not a credentials file
- Push monitor: "HomeLab Watchdog - Push" (interval: 700s, `maxretries: 0`)
