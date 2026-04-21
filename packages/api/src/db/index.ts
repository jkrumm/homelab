import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { mkdirSync } from 'node:fs'
import * as schema from './schema.js'

const DATA_DIR = process.env.DATA_DIR ?? './data'
const DB_PATH = `${DATA_DIR}/homelab.db`

mkdirSync(DATA_DIR, { recursive: true })

export const sqlite = new Database(DB_PATH)

// Performance pragmas
sqlite.run('PRAGMA journal_mode = WAL')
sqlite.run('PRAGMA foreign_keys = ON')

// Ensure tables exist on startup

sqlite.run(`
  CREATE TABLE IF NOT EXISTS daily_metrics (
    date TEXT PRIMARY KEY,
    steps INTEGER,
    distance_m INTEGER,
    total_kcal REAL,
    active_kcal REAL,
    floors_ascended REAL,
    moderate_intensity_min INTEGER,
    vigorous_intensity_min INTEGER,
    resting_hr INTEGER,
    max_hr INTEGER,
    min_hr INTEGER,
    hrv_last_night_avg INTEGER,
    hrv_last_night_5min_high INTEGER,
    hrv_weekly_avg INTEGER,
    hrv_status TEXT,
    sleep_score INTEGER,
    sleep_duration_sec INTEGER,
    deep_sleep_sec INTEGER,
    light_sleep_sec INTEGER,
    rem_sleep_sec INTEGER,
    awake_sleep_sec INTEGER,
    avg_sleep_stress REAL,
    avg_sleep_hr REAL,
    avg_sleep_respiration REAL,
    avg_stress INTEGER,
    max_stress INTEGER,
    bb_highest INTEGER,
    bb_lowest INTEGER,
    bb_charged INTEGER,
    bb_drained INTEGER,
    avg_waking_respiration REAL,
    avg_spo2 REAL,
    lowest_spo2 REAL,
    vo2_max REAL,
    completed INTEGER DEFAULT 0,
    synced_at TEXT
  )
`)

sqlite.run(`
  CREATE TABLE IF NOT EXISTS weight_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    date TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

sqlite.run(`
  CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY DEFAULT 1,
    height_cm REAL,
    birth_date TEXT,
    gender TEXT,
    goal_weight_kg REAL,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`)

sqlite.run(`
  CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    is_bodyweight INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0
  )
`)

// Seed reference exercises (safe to re-run)
sqlite.run(`
  INSERT OR IGNORE INTO exercises (id, name, category, muscle_group, is_bodyweight, display_order)
  VALUES
    ('bench_press', 'Bench Press', 'push', 'chest', 0, 1),
    ('squat', 'Squat', 'legs', 'quads', 0, 2),
    ('deadlift', 'Deadlift', 'hinge', 'posterior', 0, 3),
    ('pull_ups', 'Pull-ups', 'pull', 'back', 1, 4)
`)

sqlite.run(`
  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    date TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    rir INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

// One-time migration: rename exercise → exercise_id if the old column still exists
try {
  sqlite.run('ALTER TABLE workouts RENAME COLUMN exercise TO exercise_id')
} catch {
  // Already renamed or column doesn't exist — safe to ignore
}

// One-time migration: add rir column if it doesn't exist yet
try {
  sqlite.run('ALTER TABLE workouts ADD COLUMN rir INTEGER')
} catch {
  // Already exists — safe to ignore
}

sqlite.run(`
  CREATE TABLE IF NOT EXISTS workout_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL,
    set_type TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    reps INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

sqlite.run('CREATE INDEX IF NOT EXISTS idx_workout_sets_workout_id ON workout_sets(workout_id)')

export const db = drizzle(sqlite, { schema })
