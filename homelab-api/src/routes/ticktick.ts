import { Elysia, t } from 'elysia'
import { ticktickOps } from '../clients/ticktick'

// Accept YYYY-MM-DD from clients and convert to midnight UTC + set isAllDay.
// This keeps timezone logic on the server so any client (Raycast, CLI, etc.)
// can just send a plain date string without worrying about UTC offsets.
function normalizeDueDate(body: Record<string, unknown>): Record<string, unknown> {
  const { dueDate } = body
  if (!dueDate || typeof dueDate !== 'string') return body
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    const [y, m, d] = dueDate.split('-').map(Number)
    return { ...body, dueDate: new Date(Date.UTC(y, m - 1, d)).toISOString(), isAllDay: true }
  }
  // Already a full ISO string — still mark as all-day
  return { ...body, isAllDay: true }
}

export const ticktickRoutes = new Elysia({ prefix: '/ticktick' })
  .get('/projects', () => ticktickOps.getProjects(), {
    detail: {
      tags: ['TickTick'],
      summary: 'Get all projects',
      security: [{ BearerAuth: [] }],
    },
  })
  .get(
    '/project/:projectId/data',
    ({ params }) => ticktickOps.getProjectData(params.projectId),
    {
      params: t.Object({ projectId: t.String() }),
      detail: {
        tags: ['TickTick'],
        summary: 'Get project with tasks and columns',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post('/task', async ({ body }) => {
    const normalized = normalizeDueDate(body as Record<string, unknown>)
    console.log('[TickTick] createTask body:', JSON.stringify(normalized))
    const result = await ticktickOps.createTask(normalized)
    console.log('[TickTick] createTask response:', JSON.stringify(result))
    return result
  }, {
    body: t.Object(
      {
        title: t.String(),
        projectId: t.Optional(t.String()),
        dueDate: t.Optional(t.String()),
        priority: t.Optional(t.Number()),
        content: t.Optional(t.String()),
        startDate: t.Optional(t.String()),
        timeZone: t.Optional(t.String()),
        isAllDay: t.Optional(t.Boolean()),
      },
      { additionalProperties: true },
    ),
    detail: {
      tags: ['TickTick'],
      summary: 'Create a task. dueDate accepts YYYY-MM-DD (server converts to ISO midnight UTC) or full ISO string.',
      security: [{ BearerAuth: [] }],
    },
  })
  .post(
    '/task/:taskId',
    async ({ params, body }) => {
      const res = await ticktickOps.updateTask(params.taskId, normalizeDueDate(body as Record<string, unknown>))
      if (!res.ok) return new Response(await res.text(), { status: res.status })
      return res.json()
    },
    {
      params: t.Object({ taskId: t.String() }),
      body: t.Object(
        {
          title: t.Optional(t.String()),
          projectId: t.Optional(t.String()),
          dueDate: t.Optional(t.String()),
          priority: t.Optional(t.Number()),
          content: t.Optional(t.String()),
          status: t.Optional(t.Number()),
        },
        { additionalProperties: true },
      ),
      detail: {
        tags: ['TickTick'],
        summary: 'Update a task. dueDate accepts YYYY-MM-DD or full ISO string.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/project/:projectId/task/:taskId/complete',
    ({ params }) => ticktickOps.completeTask(params.projectId, params.taskId),
    {
      params: t.Object({ projectId: t.String(), taskId: t.String() }),
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
      detail: {
        tags: ['TickTick'],
        summary: 'Delete a task',
        security: [{ BearerAuth: [] }],
      },
    },
  )
