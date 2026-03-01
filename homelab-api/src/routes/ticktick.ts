import { Elysia, t } from 'elysia'
import { ticktickOps } from '../clients/ticktick'

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
  .post('/task', ({ body }) => ticktickOps.createTask(body), {
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
      summary: 'Create a task',
      security: [{ BearerAuth: [] }],
    },
  })
  .post(
    '/task/:taskId',
    async ({ params, body }) => {
      const res = await ticktickOps.updateTask(params.taskId, body)
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
