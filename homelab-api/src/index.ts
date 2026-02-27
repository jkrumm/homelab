import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { bearer } from '@elysiajs/bearer'
import { registerCronJobs } from './cron'
import { healthRoute } from './routes/health'

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
  .use(bearer())
  .use(healthRoute)
  .group('/api', (app) =>
    app
      .onBeforeHandle(({ bearer }) => {
        if (bearer !== process.env.HOMELAB_API_SECRET)
          return new Response('Unauthorized', { status: 401 })
      })
      // future protected routes here
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
