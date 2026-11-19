# SSH file access, batch jobs and the CPU budget

**Files** (Tailscale only): Samba — Finder → `Cmd+K` → `smb://samba.jkrumm.com` (no SSH-tunnel
fallback: sshd has `AllowTcpForwarding no`); S3 — `https://s3.jkrumm.com`, buckets are
existing folders (`docs/s3.md`). Agents use S3, never an SMB mount.

## Batch jobs on the homelab

The box has 4 cores and serves ntfy, Uptime Kuma, cloudflared and Tailscale: a batch job
that holds every core takes the alerting path down (2026-11-14: load 20-37, ntfy 1-6 s instead of
0.06 s, Kuma pushes answering 530/502). Rules for any job started from an SSH session:

- **One batch job at a time**, at most **3 worker processes** (`--workers 3`, `xargs -P3`) —
  never one per core. Check first: `ssh homelab uptime` shows load above 4 → wait.
- **Run it detached and bounded:** `nohup nice -n 19 <cmd> > ~/job.log 2>&1 &` and
  poll the log; a foreground job over SSH also streams its output through `tailscaled`.
- **The cap that applies:** everything in an SSH session lives in `user.slice`, which
  `config/systemd/user-slice-batch.conf` sets to `CPUWeight=20` / `IOWeight=20` against 100 for
  the containers (`system.slice`): the stack wins 5:1 under contention, an idle box is unaffected.
  `nice` alone does not cross cgroups. Verify: `systemctl show user.slice -p CPUWeight` = 20
  (setup, rollback and the measurements: `docs/decisions.md`).
- **Image builds are not in `user.slice`:** BuildKit runs in dockerd (`system.slice`). The
  user's current buildx builder is `lowprio` (`make builder-setup`; `cpu-shares=20`), so
  `docker compose build` yields to the stack with no flag — check `docker buildx ls` shows
  `lowprio*`; never `--builder default` for a build started from an SSH session.
- **Bulk data does not go through `ssh homelab`:** Tailscale SSH terminates in tailscaled's userspace
  stack, ~0.3 core per 0.5 MB/s. Move files over S3 (`docs/s3.md`) or SMB.
- A batch job pages no one on CPU: there is no CPU digest (Beszel is gone, `docs/decisions.md`), the ClickStack
  alert `Infra load5 per core >= 8 (30m)` only fires on a stuck box, and a service going down still pages through Kuma.
- CPU temperature is the watchdog's alert (`check_thermal`: 30-min mean, hot at 90 °C, clear below 85 °C).

## CPU budget — size a workload against this before it lands here

4 threads on an N100 under a RAPL cap (8 W / 10 W, ~1.8 GHz: `scripts/host-tuning.sh`), so a
"core" is a slow one. Measured 2026-11-15 with nothing but the stack running (`pidstat -u 60`,
`sar`): 0.4-0.8 cores used, load < 1, CPU PSI `some` avg300 < 3%. Rationale and the incidents
behind it: `docs/decisions.md`.

| Holder | Budget | Why |
|-|-|-|
| Core services: ntfy, Uptime Kuma, cloudflared, Caddy, tailscaled, dockerd | **reserved: 1 core**, never limited | Idle they use ~0.25; Kuma climbs to 0.4 when pushes arrive late and tailscaled to 0.3-0.75 while it carries an SSH stream. They must win contention, not share it |
| Homelab-owned services (Samba, Karakeep, Jellyfin, torrent stack, ...) | share the rest at default weight | Quiet use ~0.3 combined; no per-service cap until one starves a core service |
| **Guest workloads** (another repo's containers or jobs deployed here) | **all guests together <= 1.5 cores sustained, any one <= 1 core, <= 3 worker processes** | Leaves >= 1 of 4 threads idle; the 2026-11-14/15 incidents were each one guest at 1-4 cores |

Gate: CPU PSI `some` avg300 < 40% and load average < 6 with the guest running (`cat
/proc/pressure/cpu`, `uptime`); a guest that breaks it is throttled or stopped, not tolerated.

A guest declares its limits in its own compose file and states its expected CPU in its
Issue or PR:

- **Container:** `cpus: <= 1` (hard quota: a weight alone leaves every thread runnable and in the
  load average, Issue 1396) and, for batch or periodic work, `cpu_shares: 20` (weight 6 against 39
  for a default container). The restic container is the worked example (`docker-compose.yml`).
- **Job from an SSH session:** it lands in `user.slice` (weight 20) with the Batch jobs rules above.
- **Image build:** the `lowprio` builder, no flag.
- **Not covered by any limit:** `tailscaled` carrying bulk data, dm-crypt kworkers on `/mnt/hdd`
  (IO weight is inert on `mq-deadline`). Move bulk data over S3/SMB.

Enforcement stays what exists (`user.slice` weight, `lowprio`, restic `cpu_shares`/`cpus`). No
per-container limit was added for the homelab-owned stack: with the V1 guests gone nothing
starves a core service. When one does, name it in `docs/decisions.md` and limit that one.
