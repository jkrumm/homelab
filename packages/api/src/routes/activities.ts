import { Elysia, t } from 'elysia'
import { and, asc, desc, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { garminActivities } from '../db/schema.js'

const ActivitySchema = t.Object({
  activity_id: t.Number(),
  date: t.String(),
  start_time_local: t.String(),
  type_key: t.String(),
  activity_name: t.Union([t.String(), t.Null()]),
  duration_sec: t.Union([t.Number(), t.Null()]),
  distance_m: t.Union([t.Number(), t.Null()]),
  calories: t.Union([t.Number(), t.Null()]),
  avg_hr: t.Union([t.Number(), t.Null()]),
  max_hr: t.Union([t.Number(), t.Null()]),
  aerobic_te: t.Union([t.Number(), t.Null()]),
  anaerobic_te: t.Union([t.Number(), t.Null()]),
  training_effect_label: t.Union([t.String(), t.Null()]),
  training_load: t.Union([t.Number(), t.Null()]),
  moderate_intensity_min: t.Union([t.Number(), t.Null()]),
  vigorous_intensity_min: t.Union([t.Number(), t.Null()]),
  hr_zone_1_sec: t.Union([t.Number(), t.Null()]),
  hr_zone_2_sec: t.Union([t.Number(), t.Null()]),
  hr_zone_3_sec: t.Union([t.Number(), t.Null()]),
  hr_zone_4_sec: t.Union([t.Number(), t.Null()]),
  hr_zone_5_sec: t.Union([t.Number(), t.Null()]),
  bb_delta: t.Union([t.Number(), t.Null()]),
  steps: t.Union([t.Number(), t.Null()]),
  vo2_max: t.Union([t.Number(), t.Null()]),
  synced_at: t.Union([t.String(), t.Null()]),
})

export const activitiesRoutes = new Elysia({ prefix: '/activities' }).get(
  '/',
  async ({ query, set }) => {
    const conds = []
    if (query.date_from) conds.push(gte(garminActivities.date, query.date_from))
    if (query.date_to) conds.push(lte(garminActivities.date, query.date_to))
    const where = conds.length > 0 ? and(...conds) : undefined

    const rows = await db
      .select()
      .from(garminActivities)
      .where(where)
      .orderBy(
        query._order === 'desc'
          ? desc(garminActivities.start_time_local)
          : asc(garminActivities.start_time_local),
      )

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
    response: t.Array(ActivitySchema),
    detail: {
      tags: ['Activities'],
      summary: 'List Garmin activities (workouts) with optional date range filter',
      security: [{ BearerAuth: [] }],
    },
  },
)
