import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ── Exercises reference table ────────────────────────────────────────────────

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(), // "bench_press" | "squat" | "deadlift" | "pull_ups"
  name: text('name').notNull(), // "Bench Press"
  category: text('category').notNull(), // "push" | "pull" | "legs" | "hinge"
  muscle_group: text('muscle_group').notNull(), // "chest" | "back" | "quads" | "glutes" | "posterior"
  is_bodyweight: integer('is_bodyweight').default(0),
  display_order: integer('display_order').default(0),
})

// ── Garmin daily metrics (auto-synced via garmin-sync cron) ─────────

export const dailyMetrics = sqliteTable('daily_metrics', {
  date: text('date').primaryKey(), // yyyy-mm-dd

  // Activity
  steps: integer('steps'),
  distance_m: integer('distance_m'),
  total_kcal: real('total_kcal'),
  active_kcal: real('active_kcal'),
  floors_ascended: real('floors_ascended'),
  moderate_intensity_min: integer('moderate_intensity_min'),
  vigorous_intensity_min: integer('vigorous_intensity_min'),

  // Heart rate
  resting_hr: integer('resting_hr'),
  max_hr: integer('max_hr'),
  min_hr: integer('min_hr'),

  // HRV
  hrv_last_night_avg: integer('hrv_last_night_avg'),
  hrv_last_night_5min_high: integer('hrv_last_night_5min_high'),
  hrv_weekly_avg: integer('hrv_weekly_avg'),
  hrv_status: text('hrv_status'), // BALANCED | LOW | UNBALANCED

  // Sleep
  sleep_score: integer('sleep_score'),
  sleep_duration_sec: integer('sleep_duration_sec'),
  deep_sleep_sec: integer('deep_sleep_sec'),
  light_sleep_sec: integer('light_sleep_sec'),
  rem_sleep_sec: integer('rem_sleep_sec'),
  awake_sleep_sec: integer('awake_sleep_sec'),
  avg_sleep_stress: real('avg_sleep_stress'),
  avg_sleep_hr: real('avg_sleep_hr'),
  avg_sleep_respiration: real('avg_sleep_respiration'),

  // Stress / Body battery
  avg_stress: integer('avg_stress'),
  max_stress: integer('max_stress'),
  bb_highest: integer('bb_highest'),
  bb_lowest: integer('bb_lowest'),
  bb_charged: integer('bb_charged'),
  bb_drained: integer('bb_drained'),

  // Respiration
  avg_waking_respiration: real('avg_waking_respiration'),

  // SpO2
  avg_spo2: real('avg_spo2'),
  lowest_spo2: real('lowest_spo2'),

  // Fitness
  vo2_max: real('vo2_max'),

  // Meta
  completed: integer('completed').default(0), // 0 = partial, 1 = full 24h
  synced_at: text('synced_at'),
})

// ── Weight log (manual entries) ─────────────────────────────────────

export const weightLog = sqliteTable('weight_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  weight_kg: real('weight_kg').notNull(),
  created_at: text('created_at').default(sql`(datetime('now'))`),
})

// ── User profile (single row, static body data) ────────────────────

export const userProfile = sqliteTable('user_profile', {
  id: integer('id').primaryKey().default(1),
  height_cm: real('height_cm'),
  birth_date: text('birth_date'), // yyyy-mm-dd
  gender: text('gender'), // male | female
  goal_weight_kg: real('goal_weight_kg'),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
})

// ── Workouts ────────────────────────────────────────────────────────

export const workouts = sqliteTable('workouts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  exercise_id: text('exercise_id').notNull(),
  rir: integer('rir'),
  notes: text('notes'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
})

export const workoutSets = sqliteTable('workout_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workout_id: integer('workout_id')
    .notNull()
    .references(() => workouts.id, { onDelete: 'cascade' }),
  set_number: integer('set_number').notNull(),
  set_type: text('set_type').notNull(),
  weight_kg: real('weight_kg').notNull(),
  reps: integer('reps').notNull(),
  created_at: text('created_at').default(sql`(datetime('now'))`),
})
