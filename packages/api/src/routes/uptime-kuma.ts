import { Elysia, t } from 'elysia'
import { uptimeKumaClient } from '../clients/uptime-kuma'

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
    description: 'Uptime ratio over last 24 h (0.0–1.0). Null until first uptime event lands.',
  }),
  uptime30d: t.Union([t.Number(), t.Null()], {
    description: 'Uptime ratio over last 30 days (0.0–1.0). Null until first uptime event lands.',
  }),
})

const StatusFieldSchema = t.Union([t.Literal('warming'), t.Literal('ready'), t.Literal('stale')], {
  description: 'warming = no data yet · ready = live · stale = last-known data, connection lost',
})

const SnapshotSchema = t.Object({
  status: StatusFieldSchema,
  lastUpdatedAt: t.Union([t.String(), t.Null()], {
    description: 'ISO timestamp of latest event applied to in-memory state',
  }),
  staleSince: t.Union([t.String(), t.Null()], {
    description: 'ISO timestamp of last disconnect; null while ready',
  }),
  lastError: t.Union([t.String(), t.Null()]),
  monitors: t.Array(MonitorSchema),
})

export const uptimeKumaRoutes = new Elysia({ prefix: '/uptime-kuma' })

  .get('/monitors', () => uptimeKumaClient.getSnapshot(), {
    response: SnapshotSchema,
    detail: {
      tags: ['UptimeKuma'],
      summary: 'Live UptimeKuma monitor snapshot (held in memory via long-lived socket)',
      description:
        'Returns the in-memory snapshot maintained by a persistent socket.io connection to UptimeKuma. ' +
        'Includes a `status` field (warming|ready|stale) and `lastUpdatedAt` so callers can reason about freshness.',
      security: [{ BearerAuth: [] }],
    },
  })

  .get(
    '/status',
    () => {
      const snapshot = uptimeKumaClient.getSnapshot()
      const real = snapshot.monitors.filter((m) => m.type !== 'group')
      return {
        status: snapshot.status,
        lastUpdatedAt: snapshot.lastUpdatedAt,
        staleSince: snapshot.staleSince,
        lastError: snapshot.lastError,
        up: real.filter((m) => m.status === 1).length,
        down: real.filter((m) => m.status === 0).length,
        maintenance: real.filter((m) => m.status === 3).length,
        total: real.length,
      }
    },
    {
      response: t.Object({
        status: StatusFieldSchema,
        lastUpdatedAt: t.Union([t.String(), t.Null()]),
        staleSince: t.Union([t.String(), t.Null()]),
        lastError: t.Union([t.String(), t.Null()]),
        up: t.Number(),
        down: t.Number(),
        maintenance: t.Number(),
        total: t.Number(),
      }),
      detail: {
        tags: ['UptimeKuma'],
        summary: 'UptimeKuma monitor counts with freshness fields (groups excluded)',
        security: [{ BearerAuth: [] }],
      },
    },
  )
