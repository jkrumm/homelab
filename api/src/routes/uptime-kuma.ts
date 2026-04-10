import { Elysia, t } from 'elysia'
import { fetchMonitors } from '../clients/uptime-kuma'

const MonitorSchema = t.Object({
  id: t.String({ description: 'UptimeKuma monitor ID' }),
  name: t.String({ description: 'Display name' }),
  type: t.String({ description: 'Monitor type: http, keyword, docker, push, mysql, group, …' }),
  url: t.Union([t.String(), t.Null()], {
    description: 'Target URL. Null for docker, group, and push monitors.',
  }),
  active: t.Boolean({ description: 'Whether the monitor is enabled in UptimeKuma' }),
  status: t.Number({ description: '0=DOWN 1=UP 2=PENDING 3=MAINTENANCE' }),
  ping: t.Union([t.Number(), t.Null()], {
    description: 'Response latency in milliseconds. Null for docker and push monitors.',
  }),
  uptime1d: t.Union([t.Number(), t.Null()], {
    description: 'Uptime ratio over last 24 h (0.0–1.0). Null for push monitors.',
  }),
  uptime30d: t.Union([t.Number(), t.Null()], {
    description: 'Uptime ratio over last 30 days (0.0–1.0). Null for push monitors.',
  }),
})

export const uptimeKumaRoutes = new Elysia({ prefix: '/uptime-kuma' })

  .get(
    '/monitors',
    async () => {
      return fetchMonitors()
    },
    {
      response: t.Array(MonitorSchema),
      detail: {
        tags: ['UptimeKuma'],
        summary: 'Get all UptimeKuma monitors with live status and uptime',
        description:
          'Live status and ping via Socket.IO (per-request connect/disconnect). Uptime ratios (1d/30d) from Prometheus — null if unavailable.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  .get(
    '/status',
    async () => {
      const monitors = await fetchMonitors()
      const real = monitors.filter((m) => m.type !== 'group')
      return {
        up: real.filter((m) => m.status === 1).length,
        down: real.filter((m) => m.status === 0).length,
        total: real.length,
      }
    },
    {
      response: t.Object({
        up: t.Number(),
        down: t.Number(),
        total: t.Number(),
      }),
      detail: {
        tags: ['UptimeKuma'],
        summary: 'Get UptimeKuma monitor summary (up/down counts, groups excluded)',
        security: [{ BearerAuth: [] }],
      },
    },
  )
