# Group 1: Monorepo + Database Foundation

## What You're Doing

Restructure the homelab repo into a Bun monorepo and add SQLite + Drizzle ORM to the API. This is the foundation — all subsequent groups build on this structure. After this group, the API starts and passes typecheck from the new monorepo layout, SQLite is initialized, and a generic read-only query endpoint exists.

---

## Research & Exploration First

1. Read `api/package.json` — current deps, scripts, tsconfig
2. Read `api/src/index.ts` — main app structure, how routes are registered
3. Read `api/Dockerfile` — current build process, COPY paths
4. Read `docker-compose.yml` — API service definition (build context, volumes, env vars)
5. Read `.env.tpl` — secret references
6. Research Bun workspaces: how to set up `package.json` with `workspaces` field
7. Research Drizzle ORM with `bun:sqlite`: schema definition, connection setup, migration workflow
8. Research how Drizzle handles SQLite column types (TEXT vs INTEGER for dates, etc.)

---

## What to Implement

### 1. Bun monorepo structure

- Create root `package.json` with `"workspaces": ["packages/*"]`
- Move `api/` → `packages/api/` (all contents)
- Update `packages/api/package.json` with a `"name": "@homelab/api"` field
- Create `packages/dashboard/package.json` as a placeholder (just name + private: true) — Group 3 fills it in
- Run `bun install` from root to verify workspace resolution

### 2. Update Docker + build references

- Update `docker-compose.yml`: API build context from `./api` → `./packages/api`
- Update `docker-compose.yml`: API volume mount from `./api/data` → `./packages/api/data`
- Update `packages/api/Dockerfile` if any paths changed
- Update `.gitignore` — adjust `/api/node_modules/` and `/api/data/` paths to new locations

### 3. Drizzle ORM + SQLite setup

- Add `drizzle-orm` and `drizzle-kit` to `packages/api/package.json`
- Create `packages/api/src/db/schema.ts`:
  - `workouts` table: id (integer PK autoincrement), date (text), exercise (text), notes (text nullable), created_at (text default now)
  - `workout_sets` table: id (integer PK autoincrement), workout_id (integer FK → workouts.id), set_number (integer), set_type (text), weight_kg (real), reps (integer), created_at (text default now)
- Create `packages/api/src/db/index.ts`:
  - Open SQLite DB at `${DATA_DIR}/homelab.db` (DATA_DIR from env, defaults to `./data`)
  - Export Drizzle instance
  - Run schema push on startup (ensure tables exist)
- Create `packages/api/drizzle.config.ts` for drizzle-kit

### 4. Generic query endpoint

- Create `packages/api/src/routes/query.ts`:
  - `POST /query` — accepts `{ sql: string }` body
  - Validate: only SELECT statements allowed (reject INSERT/UPDATE/DELETE/DROP/ALTER/CREATE)
  - Execute via raw `bun:sqlite` (not Drizzle — this is for ad-hoc queries)
  - Return `{ rows: any[], columns: string[] }`
- Register behind auth guard in `index.ts`

### 5. Wire up database in main app

- Import and initialize DB connection in `index.ts` (or via a plugin)
- Ensure DB is ready before routes that need it

---

## Validation

```bash
# From repo root
bun install                                     # workspace resolution works
cd packages/api && bun tsc --noEmit             # typecheck passes
cd packages/api && bun run src/index.ts &        # starts without error
sleep 2
curl -s http://localhost:4000/health             # returns {"status":"ok"}
kill %1
```

Verify:

- All existing routes still listed in Swagger at `/docs`
- SQLite file created at `packages/api/data/homelab.db`
- `POST /query` with `{"sql": "SELECT 1 as test"}` returns `{"rows":[{"test":1}],"columns":["test"]}`
- `POST /query` with `{"sql": "DROP TABLE workouts"}` returns 400 error

---

## Commit

```
refactor(monorepo): restructure into Bun workspaces with packages/api and packages/dashboard

feat(api): add SQLite database with Drizzle ORM and generic query endpoint
```

Two commits: one for the structural move, one for the DB addition.

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 1
```
