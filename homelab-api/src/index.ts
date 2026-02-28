import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { bearer } from '@elysiajs/bearer'
import { registerCronJobs } from './cron'
import { healthRoute } from './routes/health'
import { ticktickRoutes } from './routes/ticktick'
import { initTickTickClient, saveTokens, initTickTickClient as reinitClient } from './clients/ticktick'

const TICKTICK_CALLBACK_URL = 'https://api.jkrumm.com/ticktick/auth/callback'
const TICKTICK_AUTH_URL = 'https://ticktick.com/oauth/authorize'
const TICKTICK_TOKEN_URL = 'https://ticktick.com/oauth/token'

initTickTickClient()

const app = new Elysia()
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
  .get('/test', () => ({ test: 'ok' }))
  .use(bearer())
  // TickTick OAuth routes (public)
  .get(
    '/ticktick/auth/start',
    () => {
      const clientId = process.env.TICKTICK_CLIENT_ID
      if (!clientId) return new Response('TickTick client ID not configured', { status: 500 })
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: TICKTICK_CALLBACK_URL,
        scope: 'tasks:read tasks:write',
      })
      return new Response(null, {
        status: 302,
        headers: { Location: `${TICKTICK_AUTH_URL}?${params}` },
      })
    },
    {
      detail: {
        tags: ['TickTick Auth'],
        summary: 'Start OAuth2 flow (open in browser)',
        description:
          'Redirects to TickTick consent page. One-time setup only — run this from a browser on your Mac.',
      },
    },
  )
  .get(
    '/ticktick/auth/callback',
    async ({ query }) => {
      const code = query.code as string | undefined
      if (!code) return new Response('Missing authorization code', { status: 400 })

      const clientId = process.env.TICKTICK_CLIENT_ID
      const clientSecret = process.env.TICKTICK_CLIENT_SECRET
      if (!clientId || !clientSecret) return new Response('TickTick credentials not configured', { status: 500 })

      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

      const res = await fetch(TICKTICK_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          redirect_uri: TICKTICK_CALLBACK_URL,
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        return new Response(`TickTick token exchange failed: ${body}`, { status: 502 })
      }

      const tokenData = await res.json()
      saveTokens(tokenData)
      reinitClient()

      return { ok: true, message: 'TickTick authenticated. Tokens saved.' }
    },
    {
      detail: {
        tags: ['TickTick Auth'],
        summary: 'OAuth2 callback — receives code, exchanges for tokens',
        description:
          'TickTick redirects here after consent. Exchanges code for access/refresh tokens and saves them to the volume.',
      },
    },
  )
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
  .onError(({ error, set }) => {
    console.error('[error]', error)
    set.status = 500
    return { error: 'Internal server error' }
  })
  .listen(3030)

registerCronJobs()

console.log('homelab-api running on port 3030')
