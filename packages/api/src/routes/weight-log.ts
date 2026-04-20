import { Elysia, t } from 'elysia'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { weightLog } from '../db/schema.js'

const WeightLogSchema = t.Object({
  id: t.Number(),
  date: t.String(),
  weight_kg: t.Number(),
  created_at: t.Union([t.String(), t.Null()]),
})

export const weightLogRoutes = new Elysia({ prefix: '/weight-log' })
  .get(
    '/',
    async ({ query, set }) => {
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(weightLog)

      set.headers['x-total-count'] = String(count)

      const rows = await db
        .select()
        .from(weightLog)
        .orderBy(query._order === 'asc' ? asc(weightLog.date) : desc(weightLog.date))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows as any
    },
    {
      query: t.Object({
        _order: t.Optional(t.String()),
      }),
      response: t.Array(WeightLogSchema),
      detail: {
        tags: ['Weight Log'],
        summary: 'List all weight entries',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, set }) => {
      const [result] = await db
        .insert(weightLog)
        .values({ date: body.date, weight_kg: body.weight_kg })
        .returning()
      set.status = 201
      return { id: result!.id }
    },
    {
      body: t.Object({
        date: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
        weight_kg: t.Number({ minimum: 30, maximum: 300 }),
      }),
      response: { 201: t.Object({ id: t.Number() }) },
      detail: {
        tags: ['Weight Log'],
        summary: 'Add a weight entry',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, set }) => {
      const [existing] = await db
        .select()
        .from(weightLog)
        .where(eq(weightLog.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }
      await db.delete(weightLog).where(eq(weightLog.id, Number(params.id)))
      return { id: Number(params.id) }
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ id: t.Number() }),
        404: t.String(),
      },
      detail: {
        tags: ['Weight Log'],
        summary: 'Delete a weight entry',
        security: [{ BearerAuth: [] }],
      },
    },
  )
