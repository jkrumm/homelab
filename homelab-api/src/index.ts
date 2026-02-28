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
  .use(
    swagger({
      provider: 'scalar',
      scalarConfig: { theme: 'purple' },
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
  .use(ticktickAuthRoutes)
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
  .listen(3030)

registerCronJobs()

console.log('homelab-api running on port 3030')
