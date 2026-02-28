import { Elysia } from 'elysia'

export const testRoute = new Elysia().get(
  '/testroutetest',
  () => ({ test: 'ok' }),
  {
    detail: { tags: ['Test'], summary: 'Test route' },
  },
)
