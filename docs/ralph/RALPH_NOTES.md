# RALPH Notes — Homelab Dashboard

Learning notes appended by Claude after each group.

---

## Group 1: Monorepo + Database Foundation

### What was implemented
Restructured the repo into a Bun workspace monorepo (`packages/api`, `packages/dashboard`), updated Docker build configuration to use the root as context, added Drizzle ORM with SQLite for the `workouts` and `workout_sets` tables, and added a `POST /query` endpoint for read-only SQL execution.

### Deviations from prompt
- Used `CREATE TABLE IF NOT EXISTS` raw SQL in `db/index.ts` for table initialization rather than drizzle-kit migrations. The schema is also defined in Drizzle syntax for future CRUD routes and drizzle-kit tooling — both approaches coexist cleanly. This avoids needing to run `drizzle-kit generate` before first startup.
- Fixed a pre-existing TypeScript error in `docker.ts`: the `createDockerRoutes` function had an explicit `: Elysia` return type annotation that conflicted with the actual inferred generic type. Removed the annotation (no logic change). Required to make typecheck pass.
- The `packages/api/.dockerignore` (pre-existing from `api/`) is kept but superseded by the root `.dockerignore` since the build context is now the repo root.

### Gotchas & surprises
- `git mv api packages/api` fails with "No such file or directory" if `packages/` doesn't exist — must `mkdir -p packages` first.
- In Bun workspaces, `bun.lock` must live at the workspace root only. After `git mv`, the lock file ends up in `packages/api/bun.lock` and must be moved to root before running `bun install`.
- The `query` route does not use Drizzle's query builder — it uses the raw `bun:sqlite` instance directly. To enable this, `db/index.ts` exports both `sqlite` (raw `Database`) and `db` (Drizzle instance).
- WAL mode pragma (`PRAGMA journal_mode = WAL`) improves concurrent read performance for SQLite.

### Future improvements
- Add drizzle-kit migration files once the schema stabilizes — run `bun db:generate` and commit the `drizzle/` folder. Switch `db/index.ts` to use `migrate()` from `drizzle-orm/bun-sqlite/migrator`.
- Consider adding a `LIMIT` cap on the `/query` endpoint to prevent runaway queries.
- The `packages/api/.dockerignore` is now dead (root `.dockerignore` takes precedence) — can be removed in a cleanup pass.

---

## Group 2: Workout REST API

### What was implemented
Full CRUD endpoints for `/workouts` and `/workout-sets`, following Refine's `simple-rest` conventions: `_start`/`_end` pagination, `_sort`/`_order` sorting, filter query params, and `x-total-count` response header. Each workout in list/get responses includes nested sets and computed 1RM metrics (Epley, Brzycki, average) plus total volume. Pull-ups use bodyweight + 70 kg as effective load. Workouts create via transaction (workout + sets atomically). Workout PATCH updates only metadata; sets have separate CRUD. Both route plugins registered behind the existing auth guard in `index.ts`.

### Deviations from prompt
- Used `as any` type assertions for 404 return branches (returning `'Not found'` string when schema expects the full object type). Elysia resolves the correct response schema by status code at runtime — the assertion avoids a TypeScript union return-type error without changing behavior.
- Skipped response schema on GET /:id and list (used `as any` cast on the return) because TypeScript can't verify the spread-merge of Drizzle row + computed metrics matches the TypeBox static type exactly.

### Gotchas & surprises
- `inArray(col, ids)` with an empty array causes a Drizzle/SQLite error — guarded by returning `[]` early if no rows were fetched.
- `and(...conds)` with a single element works fine in Drizzle; with zero elements it would produce invalid SQL, so the `conds.length > 0` guard is required.
- Brzycki formula blows up when `reps >= 37` (denominator ≤ 0) — handled by skipping Brzycki for such sets and falling back to Epley-only for `estimated_1rm`.
- Elysia context's `set` property conflicts with a natural loop variable name `set` (e.g. `for (const set of sets)`). Renamed loop variable to `s` throughout to avoid shadowing.
- `workouts.$inferInsert` gives the correct Drizzle insert type for building partial update objects; passing `undefined` fields to `update().set()` omits them from the SQL SET clause.

### Future improvements
- Add CORS headers (`Access-Control-Expose-Headers: x-total-count`) once the dashboard is wired — browsers need this header exposed to read it from fetch responses.
- Consider adding a `/workouts/:id/sets` nested route as an alias for `GET /workout-sets?workout_id=:id` for REST clarity.
- The `WorkoutSetSchema` and `SetTypeSchema` are duplicated between `workouts.ts` and `workout-sets.ts` — extract to a shared `workout-schemas.ts` once a third consumer appears.
