import { Elysia, t } from 'elysia'
import { and, asc, desc, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics } from '../db/schema.js'

const DailyMetricSchema = t.Object({
  date: t.String(),
  steps: t.Union([t.Number(), t.Null()]),
  distance_m: t.Union([t.Number(), t.Null()]),
  total_kcal: t.Union([t.Number(), t.Null()]),
  active_kcal: t.Union([t.Number(), t.Null()]),
  floors_ascended: t.Union([t.Number(), t.Null()]),
  moderate_intensity_min: t.Union([t.Number(), t.Null()]),
  vigorous_intensity_min: t.Union([t.Number(), t.Null()]),
  resting_hr: t.Union([t.Number(), t.Null()]),
  max_hr: t.Union([t.Number(), t.Null()]),
  min_hr: t.Union([t.Number(), t.Null()]),
  hrv_last_night_avg: t.Union([t.Number(), t.Null()]),
  hrv_last_night_5min_high: t.Union([t.Number(), t.Null()]),
  hrv_weekly_avg: t.Union([t.Number(), t.Null()]),
  hrv_status: t.Union([t.String(), t.Null()]),
  sleep_score: t.Union([t.Number(), t.Null()]),
  sleep_duration_sec: t.Union([t.Number(), t.Null()]),
  deep_sleep_sec: t.Union([t.Number(), t.Null()]),
  light_sleep_sec: t.Union([t.Number(), t.Null()]),
  rem_sleep_sec: t.Union([t.Number(), t.Null()]),
  awake_sleep_sec: t.Union([t.Number(), t.Null()]),
  avg_sleep_stress: t.Union([t.Number(), t.Null()]),
  avg_sleep_hr: t.Union([t.Number(), t.Null()]),
  avg_sleep_respiration: t.Union([t.Number(), t.Null()]),
  avg_stress: t.Union([t.Number(), t.Null()]),
  max_stress: t.Union([t.Number(), t.Null()]),
  bb_highest: t.Union([t.Number(), t.Null()]),
  bb_lowest: t.Union([t.Number(), t.Null()]),
  bb_charged: t.Union([t.Number(), t.Null()]),
  bb_drained: t.Union([t.Number(), t.Null()]),
  avg_waking_respiration: t.Union([t.Number(), t.Null()]),
  avg_spo2: t.Union([t.Number(), t.Null()]),
  lowest_spo2: t.Union([t.Number(), t.Null()]),
  vo2_max: t.Union([t.Number(), t.Null()]),
  completed: t.Union([t.Number(), t.Null()]),
  synced_at: t.Union([t.String(), t.Null()]),
})

export const dailyMetricsRoutes = new Elysia({ prefix: '/daily-metrics' }).get(
  '/',
  async ({ query, set }) => {
    const conds = []
    if (query.date_from) conds.push(gte(dailyMetrics.date, query.date_from))
    if (query.date_to) conds.push(lte(dailyMetrics.date, query.date_to))
    const where = conds.length > 0 ? and(...conds) : undefined

    const rows = await db
      .select()
      .from(dailyMetrics)
      .where(where)
      .orderBy(query._order === 'desc' ? desc(dailyMetrics.date) : asc(dailyMetrics.date))

    set.headers['x-total-count'] = String(rows.length)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any
  },
  {
    query: t.Object({
      date_from: t.Optional(t.String()),
      date_to: t.Optional(t.String()),
      _order: t.Optional(t.String()),
    }),
    response: t.Array(DailyMetricSchema),
    detail: {
      tags: ['Daily Metrics'],
      summary: 'List daily Garmin metrics with optional date range filter',
      security: [{ BearerAuth: [] }],
    },
  },
)
