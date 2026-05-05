---
name: audit
description: Full health audit of the homelab server across 8 phases, then offer to fix each issue found
context: main
---

# HomeLab Audit Skill

Run a full health audit of the homelab server across 8 sequential phases, then offer to fix each issue found.

**Context:** main (interactive — repair actions require confirmation)
**Execution:** Always via `ssh homelab "..."` — never local commands
**Scope:** Both `~/homelab` (main stack) and `~/homelab-private` (private stack)

---

## Instructions

Run all 8 audit phases first to gather data. After all phases complete, produce the structured report. Then for each WARN/CRITICAL finding, propose the specific fix and ask for confirmation before executing.

### Phase 1: System Resources

```bash
ssh homelab "uptime && echo '---' && free -h && echo '---' && df -h"
```

**Thresholds:**

- WARN: disk >80% on any mount, available memory <500MB, load average >4
- CRITICAL: disk >95% on any mount, load average >8

### Phase 2: Container Health

Check both stacks. Run all three sub-commands per stack.

**Main stack (`~/homelab`) — use compose label filter to avoid env var warnings:**

```bash
ssh homelab "docker ps -a --filter 'label=com.docker.compose.project=homelab' --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}'"
```

**Private stack (`~/homelab-private`):**

```bash
ssh homelab "cd ~/homelab-private && make health 2>&1"
```

**All containers — stopped, restarting, or dead (use Docker's built-in status filter):**

```bash
ssh homelab "docker ps -a --filter 'status=exited' --filter 'status=restarting' --filter 'status=dead' --format '{{.Names}}\t{{.Status}}'"
```

**Restart counts (non-zero only):**

```bash
ssh homelab "docker inspect \$(docker ps -q) --format '{{.Name}} restarts={{.RestartCount}}' 2>/dev/null | grep -v 'restarts=0'"
```

**Thresholds:**

- CRITICAL: any container not running (schema-migrator-sync and schema-migrator-async are exempt — they exit 0 intentionally)
- WARN: restart count >3 on any container
- For private stack: any service showing `not found` or non-running health status is CRITICAL

### Phase 3: Watchdog State

Check both watchdogs.

**Main watchdog** — read via the `homelab-watchdog-logs` container (avoids sudo):

```bash
ssh homelab "docker logs homelab-watchdog-logs --tail=50 2>&1"
```

Infer the escalation level from the most recent `Uptime Kuma heartbeat sent (state=X)` line. Detect `manual_intervention_required` if the phrase appears.

**Private stack watchdog** — dynamically find the watchdog log container in homelab-private:

```bash
ssh homelab "docker ps --filter 'label=com.docker.compose.project=homelab-private' --format '{{.Names}}' | grep 'watchdog-logs' | xargs -I{} docker logs {} --tail=30 2>&1 || echo 'no-private-watchdog-log'"
```

If the container doesn't exist or has no output, report that the private watchdog log is inaccessible and flag for manual check.

**Context:** Private watchdog heartbeat failures are expected when the main stack is being auto-healed (caddy/cloudflared restart breaks UptimeKuma reachability briefly). Correlate timestamps with main watchdog recovery actions before escalating.

**Thresholds (main watchdog):**

- WARN: most recent state=1 or state=2
- CRITICAL: most recent state=3 or state=4, or `manual_intervention_required` appears

**Thresholds (private watchdog):**

- WARN: any failure or recovery action in recent log lines
- CRITICAL: escalated state, repeated failures, or `manual_intervention_required`

### Phase 4: Storage & Mounts

```bash
ssh homelab "df -h --output=source,target,pcent | grep -v 'tmpfs\|efivarfs\|udev' && echo '---' && ls /mnt/hdd/ 2>&1 && echo '---' && docker system df"
```

**Thresholds:**

- CRITICAL: `/mnt/hdd` not mounted (ls fails or returns permission error)
- WARN: any mount point >80% (includes root, /mnt/transfer, /mnt/hdd)
- CRITICAL: any mount point >95%
- WARN: Docker images reclaimable >10GB, Docker total reclaimable >80GB

### Phase 5: Tailscale & Tunnel Health

```bash
ssh homelab "tailscale status && echo '---' && docker logs cloudflared --tail=20 2>&1 | grep -v 'receive buffer'"
```

**Thresholds:**

- CRITICAL: Tailscale not running or offline, tunnel connection errors
- WARN: cloudflared reconnecting events in last 20 lines
- Known benign (suppress): `failed to sufficiently increase receive buffer size` — a harmless quic-go startup warning

### Phase 6: Pending Updates

```bash
ssh homelab "docker logs watchtower --tail=10 2>&1 | grep -iE 'scheduling|updated|new version|error' | tail -5 || echo '(no recent watchtower activity)'"
```

```bash
ssh homelab "apt list --upgradable 2>/dev/null | grep -v '^Listing'"
```

**Thresholds:**

- WARN: Watchtower logs show available updates for opted-out containers (immich), any apt upgradable packages
- INFO: Watchtower auto-updated containers (expected behavior)
- INFO: "Scheduling first run" line with next run time — normal after a restart, note the scheduled time

### Phase 7: Recent Errors (Log Scan)

```bash
ssh homelab "for svc in caddy cloudflared immich_server; do echo \"=== \$svc ===\"; docker logs \$svc --tail=20 2>&1 | grep -iE 'error|fatal|panic|crash|exception' | grep -v 'context canceled' | tail -5; done"
```

```bash
ssh homelab "journalctl -p err -n 30 --no-pager 2>/dev/null | grep -v 'systemd-networkd-wait-online'"
```

```bash
ssh homelab "journalctl -p warning -n 100 --no-pager 2>/dev/null | grep -iE 'sudo|pam_unix|authentication failure|invalid user' | tail -10"
```

**Thresholds:**

- CRITICAL: panic / fatal / crash lines in any service
- WARN: repeated error patterns (3+ times in 20 lines)
- WARN: sudo authentication failures or PAM errors in journalctl (possible unauthorized access attempts)
- Known benign (suppress): Caddy `"error":"reading: context canceled"` on Dozzle/SSE endpoints — normal browser-disconnect events; `systemd-networkd-wait-online` timeouts — harmless in Docker environments

### Phase 8: UptimeKuma Monitor Coverage

Get the list of running application containers (both stacks) and compare against what's monitored in the combined monitors.yaml.

```bash
ssh homelab "docker ps --format '{{.Names}}' | grep -vE 'watchdog-logs|schema-migrator' | sort"
```

```bash
ssh homelab "grep 'docker_container:' ~/homelab/uptime-kuma/monitors.yaml | awk '{print \$2}' | sort && grep 'docker_container:' ~/homelab-private/uptime-kuma/monitors.yaml 2>/dev/null | awk '{print \$2}' | sort"
```

**Extract CF tunnel hostnames from cloudflared config (logged at startup):**

```bash
ssh homelab 'docker logs cloudflared 2>&1 | grep "Updated to new configuration" | tail -1 | grep -oP "hostname[^:]*:\\\\\"[^\\\\]*" | sed "s/.*\\\\\"//" | sort'
```

**Extract HTTP monitor URLs from both monitors.yaml files:**

```bash
ssh homelab "grep 'url: https://' ~/homelab/uptime-kuma/monitors.yaml ~/homelab-private/uptime-kuma/monitors.yaml 2>/dev/null | awk '{print \$3}' | sort"
```

Compare the CF tunnel hostnames against the HTTP monitor URLs — every tunnel hostname should have a corresponding HTTP monitor entry. Flag any hostname with no matching monitor URL.

**Exclusions** (no monitor needed):

- `homelab-watchdog-logs`

**Thresholds:**

- WARN: any running container missing a Docker monitor in either monitors.yaml
- WARN: any CF tunnel public hostname missing an HTTP monitor

**Container naming note:** Services without `container_name:` in docker-compose.yml get auto-suffixed names (`homelab-tasknotes-3`) which break Docker monitors on each recreate. Flag any and recommend adding `container_name:`.

**Repair action for missing monitors:**

1. Edit the appropriate `uptime-kuma/monitors.yaml` locally (homelab or homelab-private)
2. Add `container_name:` to docker-compose.yml for affected service
3. Commit and push
4. Apply: `ssh homelab "cd ~/homelab && git pull && make uk-sync"`
5. Verify monitors appear in UptimeKuma UI

---

## Report Format

After collecting all phase data, output:

```
# HomeLab Audit — <timestamp from uptime>

## Summary
🟢 X healthy  🟡 Y warnings  🔴 Z critical

## [1/8] System Resources      🟢/🟡/🔴
<concise findings — numbers only, skip healthy details>

## [2/8] Container Health      🟢/🟡/🔴
Main stack: <all running / list issues>
Private stack: <all running / list issues>

## [3/8] Watchdog State        🟢/🟡/🔴
Main: state=X <flags>
Private: <state / no log accessible>

## [4/8] Storage & Mounts      🟢/🟡/🔴
<mount status + docker disk usage>

## [5/8] Tailscale & Tunnel    🟢/🟡/🔴
<tailscale peer status, tunnel health>

## [6/8] Pending Updates       🟢/🟡/🔴
<list containers with updates + apt package count>

## [7/8] Recent Errors         🟢/🟡/🔴
<service-level error summary>

## [8/8] UptimeKuma Coverage   🟢/🟡/🔴
<list missing Docker monitors + missing HTTP monitors for public services>

## Recommendations
- [CRITICAL] <finding> → <proposed fix>
- [WARN] <finding> → <proposed fix>
- (if Watchtower shows updates for opted-out containers) Run `/upgrade-stack` for manually-managed containers: immich
```

---

## Repair Actions

For each CRITICAL and WARN finding, propose the fix and ask for confirmation before running.

| Finding                                | Proposed Fix                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main stack container not running       | `ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- docker compose up -d <name>"`                                                                                           |
| Private stack container not running    | `ssh homelab "cd ~/homelab-private && make up"`                                                                                                                                     |
| Container restart count >3             | Show `docker logs <name> --tail=20`, offer `docker compose restart <name>` in appropriate stack dir                                                                                 |
| Main watchdog escalation 1-2           | Show recent log, offer reset: `ssh homelab "echo 'PASSWORD' \| sudo -S bash -c 'echo 0 > /var/lib/homelab_watchdog/state'"` (get password from 1Password `Private/homelab-server`)  |
| Main watchdog escalation 3-4           | Same reset as above, plus investigate root cause in logs                                                                                                                            |
| `manual_intervention_required` present | Get password: `ROOT_PW=$(op read "op://Private/homelab-server/password")` then `ssh homelab "echo '$ROOT_PW' \| sudo -S rm /var/lib/homelab_watchdog/manual_intervention_required"` |
| Private watchdog failure               | `ssh homelab "cd ~/homelab-private && make up"` to restart the affected stack                                                                                                       |
| Cloudflared errors                     | `ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- docker compose up -d cloudflared"`                                                                                      |
| Tailscale down                         | `ssh homelab "sudo systemctl restart tailscaled"`                                                                                                                                   |
| Docker image bloat >20GB               | `ssh homelab "docker image prune -f"` (dangling only — safe)                                                                                                                        |
| Apt security updates available         | `ssh homelab "sudo apt upgrade -y --only-upgrade"`                                                                                                                                  |
| `/mnt/hdd` not mounted                 | Report mount failure + provide recovery hint (no auto-fix — LUKS encrypted, requires manual unlock)                                                                                 |
| Disk >95% full                         | Report + suggest `docker system prune` — do NOT auto-run, show command for user to confirm                                                                                          |
| Missing UptimeKuma monitor             | Edit correct monitors.yaml locally, add `container_name:` if needed, commit + push, then `ssh homelab "cd ~/homelab && git pull && make uk-sync"`                                   |

**Watchdog reset note:** The state file requires sudo. Get the server password via `op read "op://Private/homelab-server/password"` locally, then use `echo '<pw>' | sudo -S bash -c 'echo 0 > /var/lib/homelab_watchdog/state'` over SSH.

**After each repair:** Re-run the relevant phase command to verify before moving on.

**Never:** Reboot the server, run `docker compose down`, delete volumes, or take any action affecting all services simultaneously without explicit discussion.
