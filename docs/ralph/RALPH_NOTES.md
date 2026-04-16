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

---

## Group 3: Dashboard Scaffold + Deployment

### What was implemented
Created the full `packages/dashboard/` Refine v5 app with Vite, React 19, and Ant Design v5: theme toggle (dark/light, localStorage-persisted, system-preference-aware), a sidebar with "Strength Tracker" active and Docker/Monitoring/Tasks as coming-soon disabled items, and a placeholder strength tracker page. Added the `dashboard` Docker service to `docker-compose.yml` and a `dashboard.jkrumm.com` Caddy route (Tailscale-only, HTTPS redirect). Multi-stage Dockerfile: Bun build → nginx:alpine serve.

### Deviations from prompt
- `ThemedLayoutV2` and `ThemedSiderV2` do not exist in the installed `@refinedev/antd` — the actual exports are `ThemedLayout` and `ThemedSider`. The research agent's examples referenced the V2 suffix from older docs; the installed version resolved to Refine's current API.
- `DataProvider` generic type constraints (TData extends BaseRecord) cannot be satisfied by a simple stub returning `{}`. Used `as unknown as DataProvider` cast for the placeholder — this is explicitly temporary until Group 4 replaces it with Eden Treaty.
- The `Sider` render prop parameters (`items`, `collapsed`) required explicit inline type annotations (`{ items: React.ReactNode; collapsed: boolean }`) because TypeScript could not infer them from the component signature.
- Production bundle is a single 1 MB chunk (antd + Recharts + Refine). Code-splitting deferred — no user impact for a personal single-page tool.

### Gotchas & surprises
- `@ant-design/v5-patch-for-react-19` must be imported as the very first statement in `main.tsx` — before React or antd — or modal/notification statics remain broken with React 19.
- Bun workspace install resolves all packages into the root `node_modules` — there is no `packages/dashboard/node_modules/`. The Dockerfile must `COPY package.json bun.lock ./` from root, plus the dashboard's own `package.json`, before running `bun install`.
- `antd` must stay pinned to v5 (`^5.20.0`). `@refinedev/antd` peer dep is locked to `antd: "^5.23.0"`. antd v6 exists on npm but breaks `@refinedev/antd` (see refinedev/refine#7140).
- Vite resolved to v5.4.21 (not 8.x as the research agent guessed). @vitejs/plugin-react resolved to 4.x. The research agent's version numbers for Vite were wrong — production versions were the latest stable 5.x line.

### Future improvements
- Code-split the vendor bundle: separate chunks for `antd`, `recharts`, and `@refinedev/*` would reduce initial load significantly. Add `build.rollupOptions.output.manualChunks` in `vite.config.ts`.
- Add a Vite dev proxy config for the API — currently the `server.proxy` entry maps `/api` → `http://localhost:4000` but the dashboard's data provider will use Eden Treaty directly, so this proxy may be unused.
- The coming-soon sidebar items use a hand-rolled `div` for styling. Once the Refine sider's internal CSS class names are known, these could be styled to match the active items more precisely.
- Consider adding `<React.Suspense>` boundaries with `lazy()` imports per page for better code-splitting.
