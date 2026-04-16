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
  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    date TEXT NOT NULL,
    exercise TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

sqlite.run(`
  CREATE TABLE IF NOT EXISTS workout_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_id INTEGER NOT NULL REFERENCES workouts(id),
    set_number INTEGER NOT NULL,
    set_type TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    reps INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

export const db = drizzle(sqlite, { schema })
