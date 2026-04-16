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
