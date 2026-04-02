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

**Main stack (`~/homelab`):**
```bash
ssh homelab "docker compose -f ~/homelab/docker-compose.yml ps --format 'table {{.Name}}\t{{.Status}}\t{{.RunningFor}}'"
```

**Private stack (`~/homelab-private`):**
```bash
ssh homelab "cd ~/homelab-private && make health 2>&1"
```

**All containers — stopped or restarting:**
```bash
ssh homelab "docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -v ' Up '"
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

**Private stack watchdog** — read its log container if present, otherwise check the script's state file:
```bash
ssh homelab "docker logs homelab-private-watchdog-logs --tail=30 2>&1 || ssh homelab 'tail -30 /var/log/homelab_private_watchdog.log 2>/dev/null || echo no-private-watchdog-log'"
```

If neither log source exists, report that the private watchdog log is inaccessible and flag for manual check.

**Thresholds (main watchdog):**
- WARN: most recent state=1 or state=2
- CRITICAL: most recent state=3 or state=4, or `manual_intervention_required` appears

**Thresholds (private watchdog):**
- WARN: any failure or recovery action in recent log lines
- CRITICAL: escalated state, repeated failures, or `manual_intervention_required`

### Phase 4: Storage & Mounts

```bash
ssh homelab "mount | grep -E 'hdd|ssd|nvme' | awk '{print \$1,\$3,\$5}' && echo '---' && ls /mnt/hdd/ 2>&1 && echo '---' && docker system df"
```

**Thresholds:**
- CRITICAL: `/mnt/hdd` not mounted (ls fails or returns permission error)
- WARN: Docker images layer size >20GB, Docker total reclaimable >80GB

### Phase 5: Tailscale & Tunnel Health

```bash
ssh homelab "tailscale status && echo '---' && docker logs cloudflared --tail=20 2>&1"
```

**Thresholds:**
- CRITICAL: Tailscale not running or offline, tunnel connection errors
- WARN: cloudflared reconnecting events in last 20 lines

### Phase 6: Pending Updates

```bash
ssh homelab "docker logs watchtower --tail=30 2>&1 | grep -iE 'updated|found|new version|error' | tail -10"
```

```bash
ssh homelab "apt list --upgradable 2>/dev/null | grep -v '^Listing'"
```

**Thresholds:**
- WARN: Watchtower logs show available updates for opted-out containers (immich, plausible), any apt upgradable packages
- INFO: Watchtower auto-updated containers (expected behavior)

### Phase 7: Recent Errors (Log Scan)

```bash
ssh homelab "for svc in caddy cloudflared immich_server; do echo \"=== \$svc ===\"; docker logs \$svc --tail=20 2>&1 | grep -iE 'error|fatal|panic|crash|exception' | tail -5; done && journalctl -p err -n 20 --no-pager 2>/dev/null"
```

**Thresholds:**
- CRITICAL: panic / fatal / crash lines in any service
- WARN: repeated error patterns (3+ times in 20 lines)

### Phase 8: UptimeKuma Monitor Coverage

Get the list of running application containers (both stacks) and compare against what's monitored in the combined monitors.yaml.

```bash
ssh homelab "docker ps --format '{{.Names}}' | grep -vE 'watchdog-logs|backup-logs|schema-migrator' | sort"
```

```bash
ssh homelab "grep 'docker_container:' ~/homelab/uptime-kuma/monitors.yaml | awk '{print \$2}' | sort && grep 'docker_container:' ~/homelab-private/uptime-kuma/monitors.yaml 2>/dev/null | awk '{print \$2}' | sort"
```

```bash
ssh homelab "docker logs cloudflared --tail=3 2>&1 | grep 'Updated to new configuration' | tail -1"
```

Compare the combined container lists. Also extract CF tunnel hostnames from cloudflared config and verify each has an HTTP monitor.

**Exclusions** (no monitor needed):
- `homelab-watchdog-logs`, `database-backup-logs`

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
- (if Watchtower shows updates for opted-out containers) Run `/upgrade-stack` for manually-managed containers: immich, plausible
```

---

## Repair Actions

For each CRITICAL and WARN finding, propose the fix and ask for confirmation before running.

| Finding | Proposed Fix |
|-|-|
| Main stack container not running | `ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- docker compose up -d <name>"` |
| Private stack container not running | `ssh homelab "cd ~/homelab-private && make up"` |
| Container restart count >3 | Show `docker logs <name> --tail=20`, offer `docker compose restart <name>` in appropriate stack dir |
| Main watchdog escalation 1-2 | Show recent log, offer reset: `ssh homelab "echo 'PASSWORD' \| sudo -S bash -c 'echo 0 > /var/lib/homelab_watchdog/state'"` (get password from 1Password `Private/homelab-server`) |
| Main watchdog escalation 3-4 | Same reset as above, plus investigate root cause in logs |
| `manual_intervention_required` present | `ssh homelab "sudo rm /var/lib/homelab_watchdog/manual_intervention_required"` |
| Private watchdog failure | `ssh homelab "cd ~/homelab-private && make up"` to restart the affected stack |
| Cloudflared errors | `ssh homelab "cd ~/homelab && op run --env-file=.env.tpl -- docker compose up -d cloudflared"` |
| Tailscale down | `ssh homelab "sudo systemctl restart tailscaled"` |
| Docker image bloat >20GB | `ssh homelab "docker image prune -f"` (dangling only — safe) |
| Apt security updates available | `ssh homelab "sudo apt upgrade -y --only-upgrade"` |
| `/mnt/hdd` not mounted | Report mount failure + provide recovery hint (no auto-fix — LUKS encrypted, requires manual unlock) |
| Disk >95% full | Report + suggest `docker system prune` — do NOT auto-run, show command for user to confirm |
| Missing UptimeKuma monitor | Edit correct monitors.yaml locally, add `container_name:` if needed, commit + push, then `ssh homelab "cd ~/homelab && git pull && make uk-sync"` |

**Watchdog reset note:** The state file requires sudo. Get the server password via `op read "op://Private/homelab-server/password"` locally, then use `echo '<pw>' | sudo -S bash -c 'echo 0 > /var/lib/homelab_watchdog/state'` over SSH.

**After each repair:** Re-run the relevant phase command to verify before moving on.

**Never:** Reboot the server, run `docker compose down`, delete volumes, or take any action affecting all services simultaneously without explicit discussion.
