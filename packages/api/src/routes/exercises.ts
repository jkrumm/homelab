import { Elysia, t } from 'elysia'
import { asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { exercises } from '../db/schema.js'

const ExerciseRowSchema = t.Object({
  id: t.String(),
  name: t.String(),
  category: t.String(),
  muscle_group: t.String(),
  is_bodyweight: t.Union([t.Number(), t.Null()]),
  display_order: t.Union([t.Number(), t.Null()]),
})

export const exerciseRoutes = new Elysia({ prefix: '/exercises' }).get(
  '/',
  async () => {
    return db.select().from(exercises).orderBy(asc(exercises.display_order))
  },
  {
    response: t.Array(ExerciseRowSchema),
    detail: {
      tags: ['Exercises'],
      summary: 'List all exercises sorted by display_order',
      security: [{ BearerAuth: [] }],
    },
  },
)
