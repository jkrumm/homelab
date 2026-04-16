import { Elysia, t } from 'elysia'
import { sqlite } from '../db/index.js'

// Block any mutation or schema-altering keywords
const BLOCKED =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE|EXEC|EXECUTE|ATTACH|DETACH)\b/i

export const queryRoute = new Elysia().post(
  '/query',
  ({ body, set }) => {
    const { sql } = body
    const trimmed = sql.trim()

    if (!trimmed.toUpperCase().startsWith('SELECT') || BLOCKED.test(trimmed)) {
      set.status = 400
      return { error: 'Only SELECT statements are allowed' }
    }

    try {
      const stmt = sqlite.query(trimmed)
      const rows = stmt.all() as Record<string, unknown>[]
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : []
      return { rows, columns }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Query failed' }
    }
  },
  {
    body: t.Object({ sql: t.String({ minLength: 1 }) }),
    detail: {
      tags: ['Database'],
      summary: 'Execute a read-only SQL query',
      description:
        'Executes a SELECT statement against the homelab SQLite database. Only SELECT statements are permitted. Useful for ad-hoc chart queries and agent consumption.',
      security: [{ BearerAuth: [] }],
    },
  },
)
