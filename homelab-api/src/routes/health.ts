import { Elysia } from 'elysia'

export const healthRoute = new Elysia().get(
  '/health',
  () => ({ status: 'ok' }),
  {
    detail: { tags: ['System'], summary: 'Health check' },
  },
)
