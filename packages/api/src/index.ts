import { Elysia } from 'elysia'
import { bearer } from '@elysiajs/bearer'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { healthRoute } from './routes/health.js'
import { ticktickRoutes } from './routes/ticktick.js'
import { uptimeKumaRoutes } from './routes/uptime-kuma.js'
import { dockerHomelabRoutes, dockerVpsRoutes } from './routes/docker.js'
import { summaryRoute } from './routes/summary.js'
import { slackRoutes } from './routes/slack.js'
import { oauthRoutes } from './routes/oauth.js'
import { gmailRoutes } from './routes/gmail.js'
import { weatherRoutes } from './routes/weather.js'
import { queryRoute } from './routes/query.js'
import { workoutRoutes } from './routes/workouts.js'
import { workoutSetRoutes } from './routes/workout-sets.js'
import { registerCronJobs } from './cron/index.js'
// eslint-disable-next-line import/no-unassigned-import
import './db/index.js' // Initialize DB and ensure tables exist

const SECRET = process.env.API_SECRET

const authGuard = new Elysia({ name: 'auth' }).use(bearer()).onBeforeHandle(({ bearer, set }) => {
  if (bearer !== SECRET) {
    set.status = 401
    return 'Unauthorized'
  }
})

export const app = new Elysia()
  .use(
    cors({
      origin: ['https://dashboard.jkrumm.com', 'http://localhost:5173'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['x-total-count'],
    }),
  )
  .use(
    swagger({
      provider: 'scalar',
      path: '/docs',
      documentation: {
        info: {
          title: 'jkrumm-api',
          version: '0.1.0',
          description:
            'Personal homelab API — TickTick tasks, UptimeKuma monitoring, Docker containers, Slack messaging. All endpoints except /health require Bearer token authentication.',
        },
        servers: [{ url: 'https://api.jkrumm.com', description: 'HomeLab' }],
        components: {
          securitySchemes: {
            BearerAuth: { type: 'http', scheme: 'bearer' },
          },
        },
      },
    }),
  )
  .get('/openapi.json', ({ redirect }) => redirect('/docs/json'))
  .use(healthRoute)
  .use(oauthRoutes)
  .use(authGuard)
  .use(ticktickRoutes)
  .use(uptimeKumaRoutes)
  .use(dockerHomelabRoutes)
  .use(dockerVpsRoutes)
  .use(slackRoutes)
  .use(gmailRoutes)
  .use(weatherRoutes)
  .use(summaryRoute)
  .use(queryRoute)
  .use(workoutRoutes)
  .use(workoutSetRoutes)
  .listen(4000)

export type App = typeof app

registerCronJobs()
// eslint-disable-next-line no-console
console.log('api running on port 4000')
