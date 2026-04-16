import { Elysia, t } from 'elysia'

interface DockerContainer {
  Id: string
  Names: string[]
  Image: string
  State: string
  Status: string
  Created: number
  HostConfig: { RestartPolicy?: { Name?: string } }
  Labels: Record<string, string>
}

interface DockerInspect {
  RestartCount: number
  State: {
    Health?: { Status: string }
    StartedAt: string
  }
}

interface DockerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number; percpu_usage?: number[] }
    system_cpu_usage: number
    online_cpus?: number
  }
  precpu_stats: {
    cpu_usage: { total_usage: number }
    system_cpu_usage: number
  }
  memory_stats: {
    usage: number
    limit: number
  }
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>
}

function calcCpuPercent(stats: DockerStats): number {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage
  const numCpus = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1
  if (systemDelta <= 0 || cpuDelta < 0) return 0
  return Math.round((cpuDelta / systemDelta) * numCpus * 100 * 100) / 100
}

function createDockerRoutes(proxyUrl: string, tag: string) {
  async function dockerGet<T>(path: string): Promise<T> {
    const res = await fetch(`${proxyUrl}${path}`)
    if (!res.ok) throw new Error(`Docker API ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  }

  return new Elysia()

    .get(
      '/containers',
      async () => {
        const containers = await dockerGet<DockerContainer[]>('/containers/json?all=1')

        const enriched = await Promise.all(
          containers.map(async (c) => {
            let restartCount = 0
            let health: string = 'none'
            let startedAt: string | null = null

            try {
              const inspect = await dockerGet<DockerInspect>(`/containers/${c.Id}/json`)
              restartCount = inspect.RestartCount
              health = inspect.State.Health?.Status ?? 'none'
              startedAt = inspect.State.StartedAt
            } catch {
              // best-effort
            }

            return {
              id: c.Id.slice(0, 12),
              name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
              image: c.Image,
              state: c.State,
              status: c.Status,
              health,
              startedAt,
              restartCount,
            }
          }),
        )

        return enriched
      },
      {
        response: t.Array(
          t.Object({
            id: t.String({ description: 'Short 12-char container ID' }),
            name: t.String(),
            image: t.String(),
            state: t.String({ description: 'running | exited | paused | created | restarting' }),
            status: t.String({ description: 'Human-readable status string from Docker' }),
            health: t.String({ description: 'healthy | unhealthy | starting | none' }),
            startedAt: t.Union([t.String(), t.Null()]),
            restartCount: t.Number({ description: 'Total restart count since container creation' }),
          }),
        ),
        detail: {
          tags: [tag],
          summary: 'List all containers (running + stopped) with health and restart count',
          security: [{ BearerAuth: [] }],
        },
      },
    )

    .get(
      '/stats',
      async () => {
        const containers = await dockerGet<DockerContainer[]>('/containers/json')

        const stats = await Promise.all(
          containers.map(async (c) => {
            try {
              const s = await dockerGet<DockerStats>(`/containers/${c.Id}/stats?stream=false`)
              const memUsageMB = Math.round(s.memory_stats.usage / 1024 / 1024)
              const memLimitMB = Math.round(s.memory_stats.limit / 1024 / 1024)
              const netRx = Object.values(s.networks ?? {}).reduce((sum, n) => sum + n.rx_bytes, 0)
              const netTx = Object.values(s.networks ?? {}).reduce((sum, n) => sum + n.tx_bytes, 0)
              return {
                name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
                cpuPercent: calcCpuPercent(s),
                memUsageMB,
                memLimitMB,
                memPercent:
                  memLimitMB > 0 ? Math.round((memUsageMB / memLimitMB) * 10000) / 100 : 0,
                netRxMB: Math.round((netRx / 1024 / 1024) * 100) / 100,
                netTxMB: Math.round((netTx / 1024 / 1024) * 100) / 100,
              }
            } catch {
              return {
                name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
                error: 'stats unavailable',
              }
            }
          }),
        )

        return stats
      },
      {
        response: t.Array(
          t.Union([
            t.Object({
              name: t.String(),
              cpuPercent: t.Number({ description: 'CPU usage as percentage of all cores' }),
              memUsageMB: t.Number({ description: 'Current memory usage in MiB' }),
              memLimitMB: t.Number({ description: 'Container memory limit in MiB' }),
              memPercent: t.Number({ description: 'Memory usage as percentage of limit' }),
              netRxMB: t.Number({ description: 'Total network bytes received in MB' }),
              netTxMB: t.Number({ description: 'Total network bytes transmitted in MB' }),
            }),
            t.Object({
              name: t.String(),
              error: t.String({ description: 'Error message if stats were unavailable' }),
            }),
          ]),
        ),
        detail: {
          tags: [tag],
          summary: 'Resource usage (CPU%, memory MB, network I/O) for all running containers',
          security: [{ BearerAuth: [] }],
        },
      },
    )

    .get(
      '/logs/:name',
      async ({ params, query }) => {
        const tail = query.tail ?? '100'

        const containers = await dockerGet<DockerContainer[]>('/containers/json?all=1')
        const match = containers.find(
          (c) =>
            c.Names.some((n) => n.replace(/^\//, '') === params.name) ||
            c.Id.startsWith(params.name),
        )
        if (!match) {
          throw new Error(`Container "${params.name}" not found`)
        }

        const res = await fetch(
          `${proxyUrl}/containers/${match.Id}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`,
        )
        if (!res.ok) throw new Error(`Docker logs ${res.status}: ${await res.text()}`)

        const buf = await res.arrayBuffer()
        const bytes = new Uint8Array(buf)
        // eslint-disable-next-line no-control-regex
        const ansiRe = /\x1b\[[0-9;]*[mGKHF]/g
        const timestampRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/
        const lines: string[] = []
        let i = 0
        while (i + 8 <= bytes.length) {
          const size =
            (bytes[i + 4] << 24) | (bytes[i + 5] << 16) | (bytes[i + 6] << 8) | bytes[i + 7]
          const payload = bytes.slice(i + 8, i + 8 + size)
          const line = new TextDecoder()
            .decode(payload)
            .replace(/\n$/, '')
            .replace(ansiRe, '')
            .trim()
          if (line && line.replace(timestampRe, '').trim()) lines.push(line)
          i += 8 + size
        }

        return { container: params.name, tail: Number(tail), lines }
      },
      {
        params: t.Object({ name: t.String() }),
        query: t.Object({ tail: t.Optional(t.String()) }),
        response: t.Object({
          container: t.String(),
          tail: t.Number({ description: 'Number of log lines requested' }),
          lines: t.Array(t.String({ description: 'Log line with RFC3339 timestamp prefix' })),
        }),
        detail: {
          tags: [tag],
          summary: 'Fetch recent log lines for a container by name (default: last 100)',
          security: [{ BearerAuth: [] }],
        },
      },
    )

    .get(
      '/summary',
      async () => {
        const [containers, dockerInfo] = await Promise.all([
          dockerGet<DockerContainer[]>('/containers/json?all=1'),
          dockerGet<{
            NCPU: number
            MemTotal: number
            Containers: number
            ContainersRunning: number
            ContainersStopped: number
            ContainersPaused: number
            ServerVersion: string
          }>('/info'),
        ])

        const inspected = await Promise.all(
          containers.map(async (c) => {
            try {
              const inspect = await dockerGet<DockerInspect>(`/containers/${c.Id}/json`)
              return {
                name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
                image: c.Image.replace(/^sha256:/, '').slice(0, 40),
                state: c.State,
                status: c.Status,
                health: inspect.State.Health?.Status ?? 'none',
                restartCount: inspect.RestartCount,
                startedAt: inspect.State.StartedAt,
              }
            } catch {
              return {
                name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
                image: c.Image,
                state: c.State,
                status: c.Status,
                health: 'unknown',
                restartCount: -1,
                startedAt: null,
              }
            }
          }),
        )

        const running = inspected.filter((c) => c.state === 'running')
        const stopped = inspected.filter((c) => c.state !== 'running')
        const unhealthy = running.filter((c) => c.health === 'unhealthy')
        const highRestarts = running.filter((c) => c.restartCount > 3)

        return {
          host: {
            cpus: dockerInfo.NCPU,
            totalMemoryGB: Math.round((dockerInfo.MemTotal / 1024 / 1024 / 1024) * 10) / 10,
            dockerVersion: dockerInfo.ServerVersion,
          },
          counts: {
            total: containers.length,
            running: running.length,
            stopped: stopped.length,
          },
          alerts: {
            unhealthyContainers: unhealthy.map((c) => c.name),
            highRestartContainers: highRestarts.map((c) => ({
              name: c.name,
              restarts: c.restartCount,
            })),
          },
          running: running.map((c) => ({
            name: c.name,
            health: c.health,
            restartCount: c.restartCount,
            startedAt: c.startedAt,
          })),
          stopped: stopped.map((c) => ({ name: c.name, status: c.status })),
        }
      },
      {
        response: t.Object({
          host: t.Object({
            cpus: t.Number(),
            totalMemoryGB: t.Number(),
            dockerVersion: t.String(),
          }),
          counts: t.Object({
            total: t.Number(),
            running: t.Number(),
            stopped: t.Number(),
          }),
          alerts: t.Object({
            unhealthyContainers: t.Array(t.String()),
            highRestartContainers: t.Array(
              t.Object({
                name: t.String(),
                restarts: t.Number({ description: 'Restart count (>3 triggers alert)' }),
              }),
            ),
          }),
          running: t.Array(
            t.Object({
              name: t.String(),
              health: t.String({ description: 'healthy | unhealthy | starting | none' }),
              restartCount: t.Number(),
              startedAt: t.Union([t.String(), t.Null()]),
            }),
          ),
          stopped: t.Array(t.Object({ name: t.String(), status: t.String() })),
        }),
        detail: {
          tags: [tag],
          summary:
            'Single-call overview: host resources, running/stopped containers, unhealthy + high-restart alerts',
          security: [{ BearerAuth: [] }],
        },
      },
    )
}

// Homelab: read-only socket proxy on internal Docker network
export const dockerHomelabRoutes = new Elysia({ prefix: '/docker/homelab' }).use(
  createDockerRoutes('http://docker-socket-proxy:2375', 'Docker - HomeLab'),
)

// VPS: read-only socket-proxy-claude exposed on Tailscale interface (port 2376)
export const dockerVpsRoutes = new Elysia({ prefix: '/docker/vps' }).use(
  createDockerRoutes(`http://${process.env.VPS_TAILSCALE_IP}:2376`, 'Docker - VPS'),
)
