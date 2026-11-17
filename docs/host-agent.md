# Host agent: host and container metrics into ClickStack

`host-agent` and `host-probe` put the homelab's host and container metrics into the estate's ClickStack on the VPS
(`host.name=homelab`, `service.namespace=infra`, `deployment.environment.name=prod`). They run the agent of the vps repo
(Issue 2055: a slim OpenTelemetry Collector built with ocb, collector 0.165.0; design and measurements on the VPS in that
repo's `docs/observability.md` → Host agent). Beszel keeps running next to them until the parity below is judged enough.

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
missing. To bump the collector: change the version in `manifest.yaml`, `Dockerfile` and the `image:` tag in `docker-compose.yml`,
then `make host-agent-deploy`; keep it in step with the vps repo.

**Limits.** `mem_limit: 128m`, `cpus: 0.5`, `cpu_shares: 20` (a guest of the 4-core box, `docs/ssh-and-batch.md`), a
`memory_limiter` at 96 MiB, no capability, read-only root filesystem.

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

## Against Beszel

The Beszel alerts live in the hub (`scripts/beszel-alerts.sh` routes them: status, memory, disk to `alerts`; CPU and the load
alerts to the `watchdog` digest). The ClickStack side is alerts and tiles in the vps repo (`Infra - Hosts`); the homelab rows
need `host.name` filters there (signal filed, see below).

| Beszel alert | ClickHouse metric | Covered by |
|-|-|-|
| Status (system down) | `system.cpu.utilization`, any `host.name=homelab` sample | `homelab host silent < 1 sample (10m)`, added in the vps repo |
| Memory | `system.memory.utilization`, `state=used` | `Infra memory >= 90% (15m)`, grouped by host |
| Disk | `system.filesystem.utilization` per `system.filesystem.mountpoint` (`/`, `/mnt/hdd`) | `Infra filesystem >= 85% (15m)`, grouped by host and mount |
| CPU 80 % for 10 min (digest) | `system.cpu.utilization`, states other than `idle` | tile `CPU utilisation`, no alert (Beszel's was a digest, not a page) |
| LoadAvg5 | `system.cpu.load_average.5m` / `system.cpu.logical.count` | `Infra load5 per core >= 4 (15m)` |

Not in ClickStack: container `status` beyond running (`container.state.health.status` and `container.restarts` cover health
and restarts, `Infra container *` alerts), temperature (watchdog), SMART.

## Footprint

FOOTPRINT_PLACEHOLDER

## Verify

```bash
ssh homelab 'docker logs --tail 20 host-agent; docker logs --tail 20 host-probe; docker stats --no-stream host-agent host-probe'
agw hdx query ...   # series with host.name=homelab: skill otel
```
