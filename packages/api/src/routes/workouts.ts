import { Elysia, t } from 'elysia'
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workouts, workoutSets, exercises } from '../db/schema.js'
import { SetTypeSchema, WorkoutSetSchema } from './schemas.js'

const WorkoutWithSetsSchema = t.Object({
  id: t.Number(),
  date: t.String(),
  exercise_id: t.String(),
  exercise_name: t.Union([t.String(), t.Null()]),
  is_bodyweight: t.Union([t.Number(), t.Null()]),
  rir: t.Union([t.Integer(), t.Null()]),
  notes: t.Union([t.String(), t.Null()]),
  created_at: t.Union([t.String(), t.Null()]),
  sets: t.Array(WorkoutSetSchema),
  estimated_1rm_epley: t.Union([t.Number(), t.Null()]),
  estimated_1rm_brzycki: t.Union([t.Number(), t.Null()]),
  estimated_1rm: t.Union([t.Number(), t.Null()]),
  total_volume: t.Number(),
})

// e1RM validity gates per STRENGTH-ANALYTICS.md §2.2.
// Bodyweight for pull-ups falls back to 80 kg (no user context available server-side).
const PULL_UPS_BW = 80

function computeMetrics(
  sets: Array<{ set_type: string; weight_kg: number; reps: number }>,
  exercise_id: string,
  rir: number | null | undefined,
) {
  const isPullUps = exercise_id === 'pull_ups'
  let totalVolume = 0
  let maxEpley: number | null = null
  let maxBrzycki: number | null = null

  for (const s of sets) {
    const ew = isPullUps ? s.weight_kg + PULL_UPS_BW : s.weight_kg
    totalVolume += ew * s.reps
  }

  for (const s of sets) {
    const eligible =
      (s.set_type === 'work' || s.set_type === 'amrap') &&
      s.reps >= 1 &&
      s.reps <= 12 &&
      (rir === null || rir === undefined || rir <= 3)
    if (!eligible) continue

    const ew = isPullUps ? s.weight_kg + PULL_UPS_BW : s.weight_kg
    const epley = ew * (1 + s.reps / 30)
    maxEpley = maxEpley === null ? epley : Math.max(maxEpley, epley)

    if (s.reps <= 10) {
      const brzycki = (ew * 36) / (37 - s.reps)
      maxBrzycki = maxBrzycki === null ? brzycki : Math.max(maxBrzycki, brzycki)
    }
  }

  const e = maxEpley !== null ? Math.round(maxEpley * 10) / 10 : null
  const b = maxBrzycki !== null ? Math.round(maxBrzycki * 10) / 10 : null

  let e1rm: number | null = null
  if (e !== null && b !== null) e1rm = Math.round(((e + b) / 2) * 10) / 10
  else if (b !== null) e1rm = b
  else if (e !== null) e1rm = e

  return {
    estimated_1rm_epley: e,
    estimated_1rm_brzycki: b,
    estimated_1rm: e1rm,
    total_volume: Math.round(totalVolume * 10) / 10,
  }
}

function orderColumn(field: string) {
  if (field === 'exercise_id' || field === 'exercise') return workouts.exercise_id
  if (field === 'id') return workouts.id
  if (field === 'created_at') return workouts.created_at
  return workouts.date
}

export const workoutRoutes = new Elysia({ prefix: '/workouts' })
  .get(
    '/',
    async ({ query, set }) => {
      const start = Math.max(0, Number(query._start ?? 0))
      const end = Number(query._end ?? start + 10)
      const limit = Math.max(0, end - start)

      const conds = []
      if (query.exercise) conds.push(eq(workouts.exercise_id, query.exercise))
      if (query.date_from) conds.push(gte(workouts.date, query.date_from))
      if (query.date_to) conds.push(lte(workouts.date, query.date_to))
      const where = conds.length > 0 ? and(...conds) : undefined

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(workouts)
        .where(where)

      set.headers['x-total-count'] = String(count)

      if (limit === 0) return []

      const col = orderColumn(query._sort ?? 'date')
      const rows = await db
        .select({
          id: workouts.id,
          date: workouts.date,
          exercise_id: workouts.exercise_id,
          exercise_name: exercises.name,
          is_bodyweight: exercises.is_bodyweight,
          rir: workouts.rir,
          notes: workouts.notes,
          created_at: workouts.created_at,
        })
        .from(workouts)
        .leftJoin(exercises, eq(workouts.exercise_id, exercises.id))
        .where(where)
        .orderBy((query._order ?? 'desc') === 'asc' ? asc(col) : desc(col))
        .limit(limit)
        .offset(start)

      if (rows.length === 0) return []

      const ids = rows.map((w) => w.id)
      const allSets = await db
        .select()
        .from(workoutSets)
        .where(inArray(workoutSets.workout_id, ids))

      const setMap = new Map<number, typeof allSets>()
      for (const s of allSets) {
        const list = setMap.get(s.workout_id) ?? []
        list.push(s)
        setMap.set(s.workout_id, list)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((w) => {
        const wSets = setMap.get(w.id) ?? []
        return { ...w, sets: wSets, ...computeMetrics(wSets, w.exercise_id, w.rir) }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    },
    {
      query: t.Object({
        _start: t.Optional(t.String()),
        _end: t.Optional(t.String()),
        _sort: t.Optional(t.String()),
        _order: t.Optional(t.String()),
        exercise: t.Optional(t.String()),
        date_from: t.Optional(t.String()),
        date_to: t.Optional(t.String()),
      }),
      response: t.Array(WorkoutWithSetsSchema),
      detail: {
        tags: ['Workouts'],
        summary: 'List workouts',
        description:
          'Refine-compatible pagination (_start/_end), sorting (_sort/_order), filtering (exercise, date_from, date_to). Returns x-total-count header.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id',
    async ({ params, set }) => {
      const [row] = await db
        .select({
          id: workouts.id,
          date: workouts.date,
          exercise_id: workouts.exercise_id,
          exercise_name: exercises.name,
          is_bodyweight: exercises.is_bodyweight,
          rir: workouts.rir,
          notes: workouts.notes,
          created_at: workouts.created_at,
        })
        .from(workouts)
        .leftJoin(exercises, eq(workouts.exercise_id, exercises.id))
        .where(eq(workouts.id, Number(params.id)))
      if (!row) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }
      const sets = await db.select().from(workoutSets).where(eq(workoutSets.workout_id, row.id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ...row, sets, ...computeMetrics(sets, row.exercise_id, row.rir) } as any
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: WorkoutWithSetsSchema,
        404: t.String(),
      },
      detail: {
        tags: ['Workouts'],
        summary: 'Get workout by ID with sets and computed 1RM metrics',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, set }) => {
      const result = await db.transaction(async (tx) => {
        const [workout] = await tx
          .insert(workouts)
          .values({
            date: body.date,
            exercise_id: body.exercise_id,
            rir: body.rir ?? null,
            notes: body.notes ?? null,
          })
          .returning()
        if (body.sets.length > 0) {
          await tx.insert(workoutSets).values(
            body.sets.map((s) => ({
              workout_id: workout!.id,
              set_number: s.set_number,
              set_type: s.set_type,
              weight_kg: s.weight_kg,
              reps: s.reps,
            })),
          )
        }
        return workout!
      })
      set.status = 201
      return { id: result.id }
    },
    {
      body: t.Object({
        date: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' }),
        exercise_id: t.String(),
        rir: t.Optional(t.Union([t.Integer({ minimum: 0, maximum: 5 }), t.Null()])),
        notes: t.Optional(t.String()),
        sets: t.Array(
          t.Object({
            set_number: t.Number({ minimum: 1 }),
            set_type: SetTypeSchema,
            weight_kg: t.Number({ minimum: 0 }),
            reps: t.Integer({ minimum: 1 }),
          }),
        ),
      }),
      response: { 201: t.Object({ id: t.Number() }) },
      detail: {
        tags: ['Workouts'],
        summary: 'Create workout with sets (transactional)',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body, set }) => {
      const [existing] = await db
        .select()
        .from(workouts)
        .where(eq(workouts.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }

      await db.transaction(async (tx) => {
        const updateData: Partial<typeof workouts.$inferInsert> = {}
        if (body.date !== undefined) updateData.date = body.date
        if (body.exercise_id !== undefined) updateData.exercise_id = body.exercise_id
        if (body.rir !== undefined) updateData.rir = body.rir
        if (body.notes !== undefined) updateData.notes = body.notes

        if (Object.keys(updateData).length > 0) {
          await tx
            .update(workouts)
            .set(updateData)
            .where(eq(workouts.id, Number(params.id)))
        }

        if (body.sets !== undefined) {
          await tx.delete(workoutSets).where(eq(workoutSets.workout_id, Number(params.id)))
          if (body.sets.length > 0) {
            await tx.insert(workoutSets).values(
              body.sets.map((s) => ({
                workout_id: Number(params.id),
                set_number: s.set_number,
                set_type: s.set_type,
                weight_kg: s.weight_kg,
                reps: s.reps,
              })),
            )
          }
        }
      })

      return { id: existing.id }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        date: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
        exercise_id: t.Optional(t.String()),
        rir: t.Optional(t.Union([t.Integer({ minimum: 0, maximum: 5 }), t.Null()])),
        notes: t.Optional(t.Union([t.String(), t.Null()])),
        sets: t.Optional(
          t.Array(
            t.Object({
              set_number: t.Number({ minimum: 1 }),
              set_type: SetTypeSchema,
              weight_kg: t.Number({ minimum: 0 }),
              reps: t.Integer({ minimum: 1 }),
            }),
          ),
        ),
      }),
      response: {
        200: t.Object({ id: t.Number() }),
        404: t.String(),
      },
      detail: {
        tags: ['Workouts'],
        summary: 'Update workout (exercise_id, date, rir, notes, sets)',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, set }) => {
      const [existing] = await db
        .select()
        .from(workouts)
        .where(eq(workouts.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }

      await db.transaction(async (tx) => {
        await tx.delete(workoutSets).where(eq(workoutSets.workout_id, Number(params.id)))
        await tx.delete(workouts).where(eq(workouts.id, Number(params.id)))
      })

      return { id: Number(params.id) }
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ id: t.Number() }),
        404: t.String(),
      },
      detail: {
        tags: ['Workouts'],
        summary: 'Delete workout and cascade delete all its sets',
        security: [{ BearerAuth: [] }],
      },
    },
  )
