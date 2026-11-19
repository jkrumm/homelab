# Host agent: host and container metrics into ClickStack

`host-agent` and `host-probe` put the homelab's host and container metrics into the estate's ClickStack on the VPS
(`host.name=homelab`, `service.namespace=infra`, `deployment.environment.name=prod`). They run the agent of the vps repo
(Issue 2055: a slim OpenTelemetry Collector built with ocb, collector 0.165.0; design and measurements on the VPS in that
repo's `docs/observability.md` → Host agent). They replaced Beszel (removed 2026-11-19, Issue 2102); the parity below is what the owner accepted.

| Container | Network | `service.name` | Collects | Config |
|-|-|-|-|-|
| `host-agent` | host namespace | `host-agent` | `system.*`: CPU, memory, load, swap, disk I/O, filesystem utilisation per mount, network I/O per interface, process counts, uptime | `config/host-agent/host.yaml` |
| `host-probe` | bridge: `socket-proxy` (internal) and `host-agent-egress` | `host-probe` | `container.*` through `docker-socket-proxy` (CPU, memory, restarts, health) | `config/host-agent/probe.yaml` |

**Why two containers.** Same reason as on the VPS: the network scraper reads `/proc/net/dev`, which shows the namespace of
the reading process, so `host-agent` shares the host namespace (and mounts `/` read-only at `/hostfs`); `docker_stats` reaches
the read-only socket proxy by name (never the raw socket), so `host-probe` stays on the bridge. The Issue asked for one
service; one cannot do both. The HTTP and ICMP checks of the VPS probe are not run here.

**Image.** The vps repo publishes no image, so it is built on the server from `packages/host-agent` (`Dockerfile` and
`manifest.yaml` copied unchanged from the vps repo's `agent/`). `make host-agent-deploy` builds (the `lowprio` builder, a
first build is several minutes of one slow core) and recreates both; a plain `make deploy` builds them only when the image is
missing. To bump the collector: change the version in `manifest.yaml`, `Dockerfile`, the `image:` tag in `docker-compose.yml` and the
`service.version` lines in `config/host-agent/host.yaml` and `probe.yaml`, then `make host-agent-deploy`; keep it in step with the vps repo.

**Limits.** `mem_limit: 128m`, `cpus: 0.5`, `cpu_shares: 20` (a guest of the 4-core box, `docs/ssh-and-batch.md`), a
`memory_limiter` at 96 MiB, no capability, read-only root filesystem. `host-agent` binds the whole host root read-only because
the filesystem scraper needs each mount point (`/`, `/mnt/hdd`) under `/hostfs`; a narrower bind would hide the HDD mount. The
process runs as an unprivileged user, so only world-readable files are reachable.

**Where it sends.** OTLP/HTTP to `https://otel.jkrumm.com`, ClickStack's authed tier, with the ingestion key in the
`authorization` header (`HOST_AGENT_OTLP_KEY` ← `op://common/hyperdx/INGEST_KEY`). The key only authorizes writes and is the value
browser bundles embed; it is a copy of `op://vps/argo/HYPERDX_API_KEY_PROD` because the homelab's service account reads only
`common` and `homelab`. Rotation: rotate the vps item (`docs/observability.md` there), then copy the new value into
`common/hyperdx/INGEST_KEY` and `make host-agent-deploy`.

**Queue.** The exporter queue is on a named volume per container (`host-agent-queue`, `host-probe-queue`) and retries never
give up: samples collected while the line or ClickStack is down arrive afterwards with the timestamps they were collected with.
Both volumes live under `/var/lib/docker/volumes`; they are not backed up (nothing in them outlives a gap).

**Temperature.** Not collected: the 0.165.0 hostmetrics receiver has no hardware scraper (the module holds cpu, disk,
filesystem, load, memory, network, nfs, paging, process(es), system), so CPU temperature stays the watchdog's
(`check_thermal`, `docs/ssh-and-batch.md`). SMART is out of scope.

**Both data mounts.** `system.filesystem.utilization` reports `/` (the SSD, which holds `~/ssd`) and `/mnt/hdd` (the encrypted
HDD), plus `/boot`, `/boot/efi` and `/mnt/transfer`. If the HDD is unmounted the series for it stops, which is what the
watchdog's remount logic already acts on.

## Against Beszel (retired)

Beszel (hub and agent) was removed on 2026-11-19 (Issue 2102). Its alerts map onto alerts and tiles in the vps repo
(`Infra - Hosts` dashboard); checked before the removal: the last 24 h of `system.*` and `container.*` series with
`host.name=homelab` had samples in all 1440 minutes, and the memory, filesystem, load and host-silent alerts cover `homelab`.

| Beszel alert | ClickHouse metric | Covered by |
|-|-|-|
| Status (system down) | `system.cpu.utilization`, any `host.name=homelab` sample | `homelab host silent < 1 sample (10m)`, added in the vps repo |
| Memory | `system.memory.utilization`, `state=used` | `Infra memory >= 90% (15m)`, grouped by host |
| Disk | `system.filesystem.utilization` per `system.filesystem.mountpoint` (`/`, `/mnt/hdd`) | `Infra filesystem >= 85% (15m)`, grouped by host and mount |
| CPU 80 % for 10 min (digest) | `system.cpu.utilization`, states other than `idle` | tile `CPU utilisation`, **no alert and no replacement**: the low-priority `watchdog` digest is gone |
| LoadAvg5 | `system.cpu.load_average.5m` / `system.cpu.logical.count` | `Infra load5 per core >= 8 (30m)` (pages through the factory door; a stuck-box alert, not the old `watchdog` digest) |

Not in ClickStack: container `status` beyond running (`container.state.health.status` and `container.restarts` cover health
and restarts, `Infra container *` alerts), temperature (watchdog), SMART.

## Footprint

Measured 2026-11-18, one hour after the first start (3,684 s), on the homelab (4 cores, load 0.5):

| | Memory after 1 h (cgroup) | Memory peak | CPU over 1 h | OOM kills |
|-|-|-|-|-|
| `host-agent` | 16.8 MiB | 17.8 MiB | 3.4 s of CPU time, 0.09 % of one core | 0 |
| `host-probe` | 19.9 MiB | 26.5 MiB | 5.7 s of CPU time, 0.16 % of one core | 0 |

Together 37 MiB and 0.25 % of one core, against 128 MiB and 0.5 cores allowed each (the VPS pair measured 28 and 35 MiB). The
host-probe peak includes the catch-up after the outage test below. Load average and the alerting path were not affected (load
0.5 at the measurement; the first image build, run at `nice` on the `lowprio` builder, took about 3 minutes).

**Queue test (2026-11-18).** `host-probe` was cut off from the line with `docker network disconnect homelab_host-agent-egress
host-probe` at 07:12:58 UTC and reconnected at 07:23:14 UTC (10 min 16 s; 83 failed exports logged). Afterwards `container.cpu.utilization`
(`host.name=homelab`) held 35 rows in every minute from 07:11 to 07:25, the gap minutes included, so the samples were delivered
late with the timestamps they were collected with. `host-agent` shares the host network namespace and cannot be cut off without
root (a firewall rule on Cloudflare's addresses would also catch other `jkrumm.com` traffic); it uses the same exporter,
`sending_queue` and `file_storage` configuration, which the same binary applied identically on the VPS (the vps repo's queue test)
and in the rehearsal on this host (the queue file grew on the volume while the endpoint refused connections).

## Verify

```bash
ssh homelab 'docker logs --tail 20 host-agent; docker logs --tail 20 host-probe; docker stats --no-stream host-agent host-probe'
# ClickStack (skill otel): system.cpu.utilization, system.memory.utilization, system.filesystem.utilization (mountpoint / and /mnt/hdd),
# system.network.io and container.* with ResourceAttributes['host.name'] = 'homelab'
```
