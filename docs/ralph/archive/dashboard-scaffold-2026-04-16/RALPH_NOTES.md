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

## Group 4: Eden Treaty Data Provider + Workout Tracker Page

### What was implemented

Eden Treaty client with cross-package type sharing (`@homelab/api` path alias + `bun-types` in dashboard tsconfig), a Refine v5 DataProvider backed by Eden Treaty HTTP calls, and a full workout tracker page with a log form, two Recharts charts (1RM trend + session volume), summary stat cards, exercise filter buttons, and date range pickers — responsive with form-on-top on mobile.

### Deviations from prompt

- Added `@elysiajs/cors` to the API (required for browser to read `x-total-count` header and make cross-origin requests from dashboard). Without CORS, the dashboard would be blocked by the browser.
- Did NOT create a separate "max weight progression" chart — the 1RM trend and volume charts already cover the key metrics; a third chart cluttered the layout.
- Dashboard Dockerfile now also copies `packages/api/package.json` and `packages/api/src/` into the build stage so `bun-types` + `bun:sqlite` ambient types are resolvable during `tsc --noEmit`.

---

## Group 5: Linting + Claude Code Enablement

### What was implemented

Installed `oxlint` (1.60.0) and `prettier` (3.8.3) at the workspace root with `bun lint` / `bun format:check` scripts. Prettier normalized all source files to single quotes, no semicolons, trailing commas, 100-char print width. Created `packages/dashboard/CLAUDE.md` with an end-to-end guide for adding new pages, and `.claude/rules/refine.md` with Refine v5 / Eden Treaty / Recharts patterns. Updated root `CLAUDE.md` with the monorepo structure and local development workflow.

### Deviations from prompt

- **oxfmt not used** — oxfmt is not released as a stable npm package. Used Prettier instead (the established standard). oxfmt may become viable in the future as a drop-in replacement.
- **`no-shadow` disabled** — Elysia imports `t` from TypeBox as the validator namespace; any arrow function parameter named `t` (for task, etc.) would trigger the rule on every route file. This is a false positive for this specific Elysia usage pattern. Rule disabled in `.oxlintrc.json`.
- **`import/no-unassigned-import` disabled globally** — the `import './db/index.js'` side-effect import in `index.ts` is intentional (DB initialization). Disabling globally is fine since the codebase has only one legitimate side-effect import.
- **`react/react-in-jsx-scope` disabled** — this rule is for React 16 and earlier. React 17+ with the automatic JSX transform (`@vitejs/plugin-react` default) does not require `React` in scope. The rule was firing on every JSX component.

### Gotchas & surprises

- oxlint 1.60.0 is a far higher version than expected (training data suggested 0.x). The npm package jumped to 1.x at some point in 2025.
- `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments on multi-line expressions only suppress the immediately following line. If `as any` appears on a line 3-4 lines after the comment, it is not suppressed — the comment must be placed on the line immediately before the flagged one.
- Prettier reformatted `packages/api/src/index.ts` (the original file with double quotes + semicolons) to match the project's single-quote/no-semicolons style. This was a clean normalization.
- oxlint's `eqeqeq` error caught a real `!= null` that should have been `!== null` in `google.ts`.

### Future improvements

- Consider `oxfmt` once it reaches a stable release — it would be much faster than Prettier on large codebases.
- Add `lint` and `format:check` to a pre-commit hook or CI step so violations are caught before reaching the server.
- The `no-console` rule is set to `warn` — the one use in `index.ts` is suppressed by a comment. Consider switching to a structured logger (pino) if the API grows significantly.
- Code-split the dashboard bundle: add `rollupOptions.output.manualChunks` in `vite.config.ts` to separate `antd`, `recharts`, and `@refinedev/*` from the main bundle (currently 1.7 MB / 535 KB gzip).

### Gotchas & surprises

- Refine v5 completely changed the `useList` and `useCreate` return shapes from v4: `useList` now returns `{ result, query }` (not `{ data, isLoading }`), `useCreate` returns `{ mutate, mutation }` (not `{ mutate, isLoading }`), and `isPending` lives on `mutation.isPending`. `Pagination` type uses `currentPage` not `current`.
- `@elysiajs/eden` version is `1.4.9` while `elysia` is `1.4.28` — they have independent version numbering.
- Cross-package Eden Treaty type sharing requires `bun-types` in the dashboard's tsconfig `types` array AND `"lib": ["ES2022", ...]` (the API's `uptime-kuma.ts` uses `.at()` which requires ES2022).
- `bun-types` had to be listed in `devDependencies` of the dashboard package, not just the API package, for the dashboard's `tsc` process to resolve `bun:sqlite`.

### Future improvements

- Code-split vendor bundles: add `manualChunks` in `vite.config.ts` to separate `antd`, `recharts`, `@refinedev/*` — the current single bundle is 1.7 MB (535 KB gzip).
- Add a "max weight per work set" progression LineChart as a third chart panel.
- Cache Eden Treaty calls client-side with TanStack Query or Refine's built-in caching to avoid refetching on every render.
- The API token (`VITE_API_TOKEN`) is a build-time env var baked into the Docker image. Consider a runtime config endpoint or nginx auth header injection to avoid rebuilding the image when the token rotates.
