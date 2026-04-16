import { Elysia, t } from 'elysia'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workoutSets } from '../db/schema.js'

const SetTypeSchema = t.Union([t.Literal('warmup'), t.Literal('work'), t.Literal('drop')])

const WorkoutSetSchema = t.Object({
  id: t.Number(),
  workout_id: t.Number(),
  set_number: t.Number(),
  set_type: t.String(),
  weight_kg: t.Number(),
  reps: t.Number(),
  created_at: t.Union([t.String(), t.Null()]),
})

export const workoutSetRoutes = new Elysia({ prefix: '/workout-sets' })
  .get(
    '/',
    async ({ query, set }) => {
      const start = Math.max(0, Number(query._start ?? 0))
      const end = Number(query._end ?? start + 50)
      const limit = Math.max(0, end - start)

      const conds = []
      if (query.workout_id) conds.push(eq(workoutSets.workout_id, Number(query.workout_id)))
      const where = conds.length > 0 ? and(...conds) : undefined

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(workoutSets)
        .where(where)

      set.headers['x-total-count'] = String(count)

      if (limit === 0) return []

      const rows = await db
        .select()
        .from(workoutSets)
        .where(where)
        .orderBy(asc(workoutSets.workout_id), asc(workoutSets.set_number))
        .limit(limit)
        .offset(start)

      return rows
    },
    {
      query: t.Object({
        _start: t.Optional(t.String()),
        _end: t.Optional(t.String()),
        workout_id: t.Optional(t.String()),
      }),
      response: t.Array(WorkoutSetSchema),
      detail: {
        tags: ['Workout Sets'],
        summary: 'List workout sets',
        description:
          'Filter by workout_id. Supports _start/_end pagination. Returns x-total-count header.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, set }) => {
      const [row] = await db
        .insert(workoutSets)
        .values({
          workout_id: body.workout_id,
          set_number: body.set_number,
          set_type: body.set_type,
          weight_kg: body.weight_kg,
          reps: body.reps,
        })
        .returning()
      set.status = 201
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return row! as any
    },
    {
      body: t.Object({
        workout_id: t.Number({ minimum: 1 }),
        set_number: t.Number({ minimum: 1 }),
        set_type: SetTypeSchema,
        weight_kg: t.Number({ minimum: 0 }),
        reps: t.Integer({ minimum: 1 }),
      }),
      response: { 201: WorkoutSetSchema },
      detail: {
        tags: ['Workout Sets'],
        summary: 'Create a workout set',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body, set }) => {
      const [existing] = await db
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }

      const updateData: Partial<typeof workoutSets.$inferInsert> = {}
      if (body.set_number !== undefined) updateData.set_number = body.set_number
      if (body.set_type !== undefined) updateData.set_type = body.set_type
      if (body.weight_kg !== undefined) updateData.weight_kg = body.weight_kg
      if (body.reps !== undefined) updateData.reps = body.reps

      if (Object.keys(updateData).length > 0) {
        await db
          .update(workoutSets)
          .set(updateData)
          .where(eq(workoutSets.id, Number(params.id)))
      }

      const [updated] = await db
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.id, Number(params.id)))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return updated! as any
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        set_number: t.Optional(t.Number({ minimum: 1 })),
        set_type: t.Optional(SetTypeSchema),
        weight_kg: t.Optional(t.Number({ minimum: 0 })),
        reps: t.Optional(t.Integer({ minimum: 1 })),
      }),
      response: {
        200: WorkoutSetSchema,
        404: t.String(),
      },
      detail: {
        tags: ['Workout Sets'],
        summary: 'Update a workout set',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, set }) => {
      const [existing] = await db
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }

      await db.delete(workoutSets).where(eq(workoutSets.id, Number(params.id)))
      return { id: Number(params.id) }
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ id: t.Number() }),
        404: t.String(),
      },
      detail: {
        tags: ['Workout Sets'],
        summary: 'Delete a workout set',
        security: [{ BearerAuth: [] }],
      },
    },
  )
