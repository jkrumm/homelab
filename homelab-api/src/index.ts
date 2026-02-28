import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { bearer } from '@elysiajs/bearer'
import { registerCronJobs } from './cron'
import { healthRoute } from './routes/health'
import { ticktickAuthRoutes } from './routes/ticktick-auth'
import { ticktickRoutes } from './routes/ticktick'
import { initTickTickClient } from './clients/ticktick'

initTickTickClient()

const app = new Elysia()
  .get(
    '/ticktick/auth/start',
    () => {
      const clientId = process.env.TICKTICK_CLIENT_ID
      if (!clientId) return new Response('TickTick not configured', { status: 500 })
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: 'https://api.jkrumm.com/ticktick/auth/callback',
        scope: 'tasks:read tasks:write',
      })
      return new Response(null, {
        status: 302,
        headers: { Location: `https://ticktick.com/oauth/authorize?${params}` },
      })
    },
    {
      detail: {
        tags: ['TickTick Auth'],
        summary: 'Start OAuth2 flow',
        description: 'Open in browser',
      },
    },
  )
  .get(
    '/ticktick/auth/callback',
    async ({ query }) => {
      const code = query.code as string | undefined
      if (!code) return new Response('Missing code', { status: 400 })
      return { ok: true }  // Placeholder - implementation in ticktick-auth.ts
    },
    {
      detail: {
        tags: ['TickTick Auth'],
        summary: 'OAuth callback',
      },
    },
  )
  .use(
    swagger({
      provider: 'scalar',
      documentation: {
        info: { title: 'HomeLab API', version: '1.0.0' },
        components: {
          securitySchemes: {
            BearerAuth: { type: 'http', scheme: 'bearer' },
          },
        },
      },
      path: '/docs',
    }),
  )
  .use(healthRoute)
  .use(bearer())
  .group('/api', (app) =>
    app
      .onBeforeHandle(({ bearer }) => {
        if (bearer !== process.env.HOMELAB_API_SECRET)
          return new Response('Unauthorized', { status: 401 })
      })
      .use(ticktickRoutes)
      .get('/ping', () => ({ pong: true }), {
        detail: {
          tags: ['System'],
          summary: 'Authenticated ping',
          security: [{ BearerAuth: [] }],
        },
      }),
  )
  .onError(({ error }) => {
    console.error('[error]', error)
    return { error: 'Internal server error' }
  })
  .listen(3030)

registerCronJobs()

console.log('homelab-api running on port 3030')
