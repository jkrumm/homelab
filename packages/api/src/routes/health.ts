import { Elysia, t } from 'elysia'

export const healthRoute = new Elysia().get('/health', () => ({ status: 'ok' as const }), {
  response: t.Object({ status: t.Literal('ok') }),
  detail: { tags: ['System'], summary: 'Health check' },
})
