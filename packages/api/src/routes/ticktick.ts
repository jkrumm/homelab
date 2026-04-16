import { Elysia, t } from 'elysia'
import { ticktickOps } from '../clients/ticktick'

// ─── Inbound: accept YYYY-MM-DD, convert to UTC midnight ISO for TickTick ───

// Convert YYYY-MM-DD to UTC midnight ISO string with timeZone: UTC.
// TickTick treats the task as timezone-agnostic — the date is always correct
// regardless of account timezone or where the user is physically located.
function normalizeDueDate(body: Record<string, unknown>): Record<string, unknown> {
  const { dueDate } = body
  if (!dueDate || typeof dueDate !== 'string') return body
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error(`dueDate must be YYYY-MM-DD, got: ${dueDate}`)
  }
  const iso = `${dueDate}T00:00:00+0000`
  return { ...body, dueDate: iso, startDate: iso, isAllDay: true, timeZone: 'UTC' }
}

// ─── Outbound: extract plain YYYY-MM-DD from TickTick's ISO date string ──────

// All tasks created via this API have timeZone: UTC, so the date portion of the
// ISO string is the correct calendar date. For legacy tasks with non-UTC offsets,
// we still just return the date portion as-is (best effort).
// Idempotent: YYYY-MM-DD input passes through unchanged.
function fromTickTickISO(iso: string): string {
  return iso.slice(0, 10)
}

function normalizeTaskDates(task: Record<string, unknown>): Record<string, unknown> {
  const result = { ...task }
  if (typeof result.dueDate === 'string' && result.dueDate) {
    result.dueDate = fromTickTickISO(result.dueDate)
  }
  if (typeof result.startDate === 'string' && result.startDate) {
    result.startDate = fromTickTickISO(result.startDate)
  }
  return result
}

// Normalize SDK response { data: T } where T is a task or project data with tasks array.
function normalizeSdkResponse(sdkResult: Record<string, unknown>): Record<string, unknown> {
  const data = sdkResult.data
  if (!data || typeof data !== 'object') return sdkResult
  const d = data as Record<string, unknown>
  if (Array.isArray(d.tasks)) {
    return {
      ...sdkResult,
      data: { ...d, tasks: d.tasks.map((t) => normalizeTaskDates(t as Record<string, unknown>)) },
    }
  }
  if (typeof d.id === 'string') {
    return { ...sdkResult, data: normalizeTaskDates(d) }
  }
  return sdkResult
}

const TaskSchema = t.Object({
  id: t.Optional(t.String()),
  projectId: t.Optional(t.String()),
  title: t.Optional(t.String()),
  content: t.Optional(t.String()),
  desc: t.Optional(t.String()),
  dueDate: t.Optional(t.String({ description: 'YYYY-MM-DD' })),
  startDate: t.Optional(t.String({ description: 'YYYY-MM-DD' })),
  priority: t.Optional(t.Number({ description: '0=none 1=low 3=medium 5=high' })),
  status: t.Optional(t.Number({ description: '0=active 2=completed' })),
  isAllDay: t.Optional(t.Union([t.String(), t.Boolean()])),
  completedTime: t.Optional(t.String()),
  timeZone: t.Optional(t.String()),
  sortOrder: t.Optional(t.Number()),
})

const ProjectSchema = t.Object({
  id: t.Optional(t.String()),
  name: t.Optional(t.String()),
  color: t.Optional(t.Union([t.String(), t.Null()])),
  closed: t.Optional(t.Union([t.Boolean(), t.Null()])),
  viewMode: t.Optional(t.Union([t.String(), t.Null()])),
  permission: t.Optional(t.Union([t.String(), t.Null()])),
  kind: t.Optional(t.Union([t.String(), t.Null()])),
})

export const ticktickRoutes = new Elysia({ prefix: '/ticktick' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .get('/projects', () => ticktickOps.getProjects() as any, {
    response: t.Object({ data: t.Array(ProjectSchema) }),
    detail: {
      tags: ['TickTick'],
      summary: 'Get all projects',
      security: [{ BearerAuth: [] }],
    },
  })
  .get(
    '/project/:projectId/data',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ params }) =>
      normalizeSdkResponse(
        (await ticktickOps.getProjectData(params.projectId)) as Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    {
      params: t.Object({ projectId: t.String() }),
      response: t.Object({
        data: t.Object({
          tasks: t.Array(TaskSchema),
          columns: t.Optional(
            t.Array(t.Object({ id: t.Optional(t.String()), name: t.Optional(t.String()) })),
          ),
        }),
      }),
      detail: {
        tags: ['TickTick'],
        summary: 'Get project with tasks and columns',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .post(
    '/task',
    async ({ body }) =>
      normalizeSdkResponse(
        (await ticktickOps.createTask(normalizeDueDate(body as Record<string, unknown>))) as Record<
          string,
          unknown
        >,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    {
      body: t.Object(
        {
          title: t.String(),
          projectId: t.Optional(t.String()),
          dueDate: t.Optional(
            t.String({
              description:
                'YYYY-MM-DD only. Server converts to the correct midnight timestamp for the TickTick account timezone.',
            }),
          ),
          priority: t.Optional(t.Number({ description: '0=none, 1=low, 3=medium, 5=high' })),
          content: t.Optional(t.String()),
          startDate: t.Optional(t.String()),
          isAllDay: t.Optional(t.Boolean()),
        },
        { additionalProperties: true },
      ),
      response: t.Object({ data: TaskSchema }),
      detail: {
        tags: ['TickTick'],
        summary: 'Create a task',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/task/:taskId',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ params, body }): Promise<any> => {
      const res = await ticktickOps.updateTask(
        params.taskId,
        normalizeDueDate(body as Record<string, unknown>),
      )
      if (!res.ok) return new Response(await res.text(), { status: res.status })
      return normalizeTaskDates((await res.json()) as Record<string, unknown>)
    },
    {
      params: t.Object({ taskId: t.String() }),
      body: t.Object(
        {
          title: t.Optional(t.String()),
          projectId: t.Optional(t.String()),
          dueDate: t.Optional(t.String({ description: 'YYYY-MM-DD only' })),
          priority: t.Optional(t.Number({ description: '0=none, 1=low, 3=medium, 5=high' })),
          content: t.Optional(t.String()),
          status: t.Optional(t.Number({ description: '0=active, 2=completed' })),
        },
        { additionalProperties: true },
      ),
      response: TaskSchema,
      detail: {
        tags: ['TickTick'],
        summary: 'Update a task',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/project/:projectId/task/:taskId/complete',
    ({ params }) => ticktickOps.completeTask(params.projectId, params.taskId),
    {
      params: t.Object({ projectId: t.String(), taskId: t.String() }),
      response: t.Object({ data: t.Any() }),
      detail: {
        tags: ['TickTick'],
        summary: 'Mark task as complete',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/project/:projectId/task/:taskId',
    ({ params }) => ticktickOps.deleteTask(params.projectId, params.taskId),
    {
      params: t.Object({ projectId: t.String(), taskId: t.String() }),
      response: t.Object({ data: t.Any() }),
      detail: {
        tags: ['TickTick'],
        summary: 'Delete a task',
        security: [{ BearerAuth: [] }],
      },
    },
  )
