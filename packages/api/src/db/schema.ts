import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const workouts = sqliteTable('workouts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  exercise: text('exercise').notNull(),
  notes: text('notes'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
})

export const workoutSets = sqliteTable('workout_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workout_id: integer('workout_id')
    .notNull()
    .references(() => workouts.id),
  set_number: integer('set_number').notNull(),
  set_type: text('set_type').notNull(),
  weight_kg: real('weight_kg').notNull(),
  reps: integer('reps').notNull(),
  created_at: text('created_at').default(sql`(datetime('now'))`),
})
