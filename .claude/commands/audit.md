# HomeLab Audit Skill

Run a full health audit of the homelab server across 8 sequential phases, then offer to fix each issue found.

**Context:** main (interactive — repair actions require confirmation)
**Execution:** Always via `ssh homelab "..."` — never local commands

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

```bash
ssh homelab "docker compose -f ~/homelab/docker-compose.yml ps --format 'table {{.Name}}\t{{.Status}}\t{{.RunningFor}}'"
```

```bash
ssh homelab "docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -v ' Up '"
```

```bash
ssh homelab "docker inspect \$(docker ps -q) --format '{{.Name}} restarts={{.RestartCount}}' 2>/dev/null | grep -v 'restarts=0'"
```

**Thresholds:**
- CRITICAL: any container not running (schema-migrator-sync and schema-migrator-async are exempt — they exit 0 intentionally)
- WARN: restart count >3 on any container

### Phase 3: Watchdog State

Read via the `homelab-watchdog-logs` container which tails the watchdog log file (avoids sudo requirement):

```bash
ssh homelab "docker logs homelab-watchdog-logs --tail=50 2>&1"
```

Infer the current escalation level from the most recent `Uptime Kuma heartbeat sent (state=X)` line. Detect `manual_intervention_required` if the phrase appears in the log output.

**Thresholds:**
- WARN: most recent state=1 or state=2
- CRITICAL: most recent state=3 or state=4, or `manual_intervention_required` appears in logs

### Phase 4: Storage & Mounts

```bash
ssh homelab "mount | grep -E 'hdd|ssd|nvme' | awk '{print \$1,\$3,\$5}' && echo '---' && ls /mnt/hdd/ 2>&1 && echo '---' && docker system df"
```

**Thresholds:**
- CRITICAL: `/mnt/hdd` not mounted (ls fails or returns permission error)
- WARN: Docker images layer size >20GB, Docker total reclaimable >80GB

### Phase 5: Tailscale, Tunnel & VPN Health

```bash
ssh homelab "tailscale status && echo '---' && docker logs cloudflared --tail=20 2>&1"
```

```bash
ssh homelab "docker exec [redacted] cat /tmp/[redacted]/ip 2>/dev/null || echo 'NO_VPN_IP'"
```

```bash
ssh homelab "docker exec [redacted] [redacted]-remote -l 2>/dev/null | tail -3"
```

**Thresholds:**
- CRITICAL: Tailscale not running or offline, tunnel connection errors, [redacted] has no IP (`NO_VPN_IP`), [redacted] cannot connect to daemon
- WARN: cloudflared reconnecting events in last 20 lines, VPN IP is same as homelab's real IP (VPN not routing)

### Phase 6: Pending Updates

```bash
ssh homelab "curl -s http://localhost:3000/api/watched | python3 -c \"import sys,json; data=json.load(sys.stdin); [print(c['name'],'→',c.get('result',{}).get('tag','?')) for c in data if c.get('result',{}).get('isSemverUpdateAvailable') or c.get('result',{}).get('isDigestUpdateAvailable')]\""
```

```bash
ssh homelab "apt list --upgradable 2>/dev/null | grep -v '^Listing'"
```

**Thresholds:**
- WARN: any WUD-detected updates available, any apt upgradable packages

### Phase 7: Recent Errors (Log Scan)

Note: Phase 8 (UptimeKuma) runs after this.

```bash
ssh homelab "for svc in caddy cloudflared immich_server signoz clickhouse; do echo \"=== \$svc ===\"; docker logs \$svc --tail=20 2>&1 | grep -iE 'error|fatal|panic|crash|exception' | tail -5; done && journalctl -p err -n 20 --no-pager 2>/dev/null"
```

**Thresholds:**
- CRITICAL: panic / fatal / crash lines in any service
- WARN: repeated error patterns (3+ times in 20 lines)

### Phase 8: UptimeKuma Monitor Coverage

Get the list of running application containers and compare against what's monitored in `monitors.yaml`.

```bash
ssh homelab "docker ps --format '{{.Names}}' | grep -vE 'watchdog-logs|backup-logs|schema-migrator' | sort"
```

```bash
ssh homelab "grep 'docker_container:' ~/homelab/uptime-kuma/monitors.yaml | awk '{print \$2}' | sort"
```

```bash
ssh homelab "docker logs cloudflared --tail=3 2>&1 | grep 'Updated to new configuration' | tail -1"
```

Compare the two container lists. Also extract the CF tunnel hostnames from the cloudflared config and verify each has an HTTP monitor in monitors.yaml.

**Exclusions** (no monitor needed — internal log scrapers / one-time runners):
- `homelab-watchdog-logs`, `database-backup-logs`, `signoz-schema-migrator-sync`, `signoz-schema-migrator-async`

**Thresholds:**
- WARN: any running container missing a Docker monitor in monitors.yaml
- WARN: any CF tunnel public hostname missing an HTTP monitor in monitors.yaml

**Container naming note:** Services without `container_name:` in docker-compose.yml get auto-suffixed names (`homelab-tasknotes-3`) which break Docker monitors on each recreate. Flag any such containers and recommend adding `container_name:` to docker-compose.yml.

**Repair action for missing monitors:**
1. Edit `uptime-kuma/monitors.yaml` locally on MacBook (add missing entries)
2. Add `container_name:` to docker-compose.yml for affected service
3. Commit and push: `git push`
4. Apply on server: `ssh homelab "cd ~/homelab && git pull && doppler run -- docker compose up -d --force-recreate <service> && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py"`
5. Verify new monitors appear in UptimeKuma and configure Pushover notifications for them in the UptimeKuma UI if not already applied globally

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
<list non-running containers or high-restart containers; say "all running" if clean>

## [3/8] Watchdog State        🟢/🟡/🔴
<escalation level + any flags present>

## [4/8] Storage & Mounts      🟢/🟡/🔴
<mount status + docker disk usage>

## [5/8] Tailscale, Tunnel & VPN  🟢/🟡/🔴
<tailscale peer status, tunnel health, VPN IP + country, [redacted] connectivity>

## [6/8] Pending Updates       🟢/🟡/🔴
<list containers with updates + apt package count>

## [7/8] Recent Errors         🟢/🟡/🔴
<service-level error summary>

## [8/8] UptimeKuma Coverage   🟢/🟡/🔴
<list missing Docker monitors + missing HTTP monitors for public services>

## Recommendations
- [CRITICAL] <finding> → <proposed fix>
- [WARN] <finding> → <proposed fix>
- (if any WUD updates) Run `/upgrade-stack` for manually-managed containers: immich, signoz, plausible
```

---

## Repair Actions

For each CRITICAL and WARN finding in the Recommendations section, propose the fix and ask for confirmation before running.

| Finding | Proposed Fix |
|-|-|
| Container not running | `ssh homelab "cd ~/homelab && doppler run -- docker compose up -d <name>"` |
| Container restart count >3 | Show `docker logs <name> --tail=20`, offer `doppler run -- docker compose restart <name>` |
| Watchdog escalation level 1-2 | Show recent log, offer `ssh homelab "echo 0 | sudo tee /var/lib/homelab_watchdog/state"` |
| `manual_intervention_required` present | Offer `ssh homelab "sudo rm /var/lib/homelab_watchdog/manual_intervention_required"` |
| Cloudflared errors | `ssh homelab "cd ~/homelab && doppler run -- docker compose up -d cloudflared"` |
| Tailscale down | `ssh homelab "sudo systemctl restart tailscaled"` |
| Docker image bloat >20GB | `ssh homelab "docker image prune -f"` (dangling only — safe) |
| Apt security updates available | `ssh homelab "sudo apt upgrade -y --only-upgrade"` |
| `/mnt/hdd` not mounted | Report mount failure + provide recovery hint (no auto-fix — LUKS encrypted, requires manual unlock) |
| Disk >95% full | Report + suggest `docker system prune` — do NOT auto-run, show command for user to confirm |
| Missing UptimeKuma monitor | Edit monitors.yaml locally, add `container_name:` to docker-compose.yml if needed, commit + push, then `ssh homelab "cd ~/homelab && git pull && doppler run -- docker compose up -d --force-recreate <service> && doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py"` |

**After each repair:** Re-run the relevant phase command to verify the fix worked before moving to the next issue.

**Never:** Reboot the server, run `docker compose down`, delete volumes, or take any action affecting all services simultaneously without explicit discussion.
