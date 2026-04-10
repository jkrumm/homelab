import { Elysia, t } from 'elysia'
import { fetchMonitors } from '../clients/uptime-kuma.js'
import { ticktickOps } from '../clients/ticktick.js'
import type { Project, Task } from '../generated/ticktick/types.gen.js'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DockerContainer {
  Id: string
  Names: string[]
  State: string
}

interface DockerInspect {
  RestartCount: number
  State: { Health?: { Status: string }; StartedAt: string }
}

interface DockerInfo {
  NCPU: number
  MemTotal: number
  ServerVersion: string
}

interface DockerSummary {
  host: { cpus: number; totalMemoryGB: number; dockerVersion: string }
  counts: { total: number; running: number; stopped: number }
  alerts: {
    unhealthyContainers: string[]
    highRestartContainers: Array<{ name: string; restarts: number }>
  }
}

interface TickTaskItem {
  id: string
  title: string
  dueDate: string
  projectName: string
  priority: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function settle<T>(r: PromiseSettledResult<T>): T | { error: string } {
  return r.status === 'fulfilled'
    ? r.value
    : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchDockerSummary(proxyUrl: string): Promise<DockerSummary> {
  if (!proxyUrl) throw new Error('Docker proxy URL not configured')

  async function dockerGet<T>(path: string): Promise<T> {
    const res = await fetch(`${proxyUrl}${path}`)
    if (!res.ok) throw new Error(`Docker API ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  }

  const [containers, dockerInfo] = await Promise.all([
    dockerGet<DockerContainer[]>('/containers/json?all=1'),
    dockerGet<DockerInfo>('/info'),
  ])

  const inspected = await Promise.all(
    containers.map(async (c) => {
      const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12)
      try {
        const inspect = await dockerGet<DockerInspect>(`/containers/${c.Id}/json`)
        return {
          name,
          state: c.State,
          health: inspect.State.Health?.Status ?? 'none',
          restartCount: inspect.RestartCount,
        }
      } catch {
        return { name, state: c.State, health: 'unknown', restartCount: -1 }
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
    counts: { total: containers.length, running: running.length, stopped: stopped.length },
    alerts: {
      unhealthyContainers: unhealthy.map((c) => c.name),
      highRestartContainers: highRestarts.map((c) => ({ name: c.name, restarts: c.restartCount })),
    },
  }
}

async function fetchTickTickSummary() {
  const projectsRes = await ticktickOps.getProjects()
  const projects = (projectsRes.data ?? []) as Project[]
  const projectMap = new Map(projects.map((p) => [p.id ?? '', p.name ?? '']))

  const projectDataList = await Promise.all(
    projects
      .filter((p) => p.id)
      .map((p) => ticktickOps.getProjectData(p.id!).catch(() => null)),
  )

  const allTasks: Task[] = []
  for (const res of projectDataList) {
    if (!res?.data) continue
    const data = res.data as { tasks?: Task[] }
    if (Array.isArray(data.tasks)) allTasks.push(...data.tasks)
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const in7 = new Date()
  in7.setUTCDate(in7.getUTCDate() + 7)
  const in7Str = in7.toISOString().slice(0, 10)

  const toItem = (task: Task): TickTaskItem => ({
    id: task.id ?? '',
    title: task.title ?? '',
    dueDate: (task.dueDate ?? '').slice(0, 10),
    projectName: projectMap.get(task.projectId ?? '') ?? task.projectId ?? '',
    priority: task.priority ?? 0,
  })

  const eligible = allTasks.filter(
    (t) => t.status !== 2 && t.dueDate && (t.dueDate ?? '').length >= 10,
  )

  const overdue = eligible
    .filter((t) => (t.dueDate ?? '').slice(0, 10) < todayStr)
    .map(toItem)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.priority - a.priority)

  const dueSoon = eligible
    .filter((t) => {
      const d = (t.dueDate ?? '').slice(0, 10)
      return d >= todayStr && d <= in7Str
    })
    .map(toItem)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.priority - a.priority)

  return { overdue, dueSoon }
}

// ─── Response Schema ─────────────────────────────────────────────────────────

const errSchema = t.Object({ error: t.String() })

const DockerSummarySchema = t.Object({
  host: t.Object({ cpus: t.Number(), totalMemoryGB: t.Number(), dockerVersion: t.String() }),
  counts: t.Object({ total: t.Number(), running: t.Number(), stopped: t.Number() }),
  alerts: t.Object({
    unhealthyContainers: t.Array(t.String()),
    highRestartContainers: t.Array(t.Object({ name: t.String(), restarts: t.Number() })),
  }),
})

const TickTaskItemSchema = t.Object({
  id: t.String(),
  title: t.String(),
  dueDate: t.String({ description: 'YYYY-MM-DD' }),
  projectName: t.String(),
  priority: t.Number({ description: '0=none 1=low 3=medium 5=high' }),
})

const SummaryResponseSchema = t.Object({
  generatedAt: t.String({ description: 'ISO timestamp when summary was generated' }),
  uptimeKuma: t.Union([
    t.Object({
      up: t.Number(),
      down: t.Number(),
      maintenance: t.Number(),
      total: t.Number(),
      downMonitors: t.Array(
        t.Object({ name: t.String(), type: t.String(), uptime1d: t.Union([t.Number(), t.Null()]) }),
      ),
    }),
    errSchema,
  ]),
  dockerHomelab: t.Union([DockerSummarySchema, errSchema]),
  dockerVps: t.Union([DockerSummarySchema, errSchema]),
  ticktick: t.Union([
    t.Object({ overdue: t.Array(TickTaskItemSchema), dueSoon: t.Array(TickTaskItemSchema) }),
    errSchema,
  ]),
})

// ─── Route ───────────────────────────────────────────────────────────────────

export const summaryRoute = new Elysia().get(
  '/summary',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (): Promise<any> => {
    const [kumaResult, dockerHLResult, dockerVPSResult, ticktickResult] =
      await Promise.allSettled([
        withTimeout(fetchMonitors().then((monitors) => {
          const nonGroup = monitors.filter((m) => m.type !== 'group')
          return {
            up: nonGroup.filter((m) => m.status === 1).length,
            down: nonGroup.filter((m) => m.status === 0).length,
            maintenance: nonGroup.filter((m) => m.status === 3).length,
            total: nonGroup.length,
            downMonitors: nonGroup
              .filter((m) => m.status === 0)
              .map((m) => ({ name: m.name, type: m.type, uptime1d: m.uptime1d })),
          }
        }), 10_000, 'uptimeKuma'),
        withTimeout(fetchDockerSummary('http://docker-socket-proxy:2375'), 10_000, 'dockerHomelab'),
        withTimeout(fetchDockerSummary(`http://${process.env.VPS_TAILSCALE_IP}:2376`), 10_000, 'dockerVps'),
        withTimeout(fetchTickTickSummary(), 15_000, 'ticktick'),
      ])

    return {
      generatedAt: new Date().toISOString(),
      uptimeKuma: settle(kumaResult),
      dockerHomelab: settle(dockerHLResult),
      dockerVps: settle(dockerVPSResult),
      ticktick: settle(ticktickResult),
    }
  },
  {
    response: SummaryResponseSchema,
    detail: {
      tags: ['Summary'],
      summary: 'Aggregated health snapshot — UptimeKuma, Docker (HomeLab + VPS), TickTick tasks',
      security: [{ BearerAuth: [] }],
    },
  },
)
