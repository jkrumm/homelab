# PRD: Homelab Dashboard (Refine v5)

## Problem

The homelab-api exposes rich data (Docker, UptimeKuma, TickTick, Slack, Gmail, weather) but has no UI. Building admin dashboards and BI views requires a frontend scaffold optimized for rapid LLM-assisted development. The API lacks a database — limiting it to stateless proxying with no ability to store custom data.

## Goals

- **Bun monorepo** with Eden Treaty for end-to-end type safety between API and dashboard
- **Refine v5 scaffold** — Ant Design UI, Recharts, conventions that LLMs produce reliably
- **SQLite database** via Drizzle ORM — schema-as-code with migrations
- **Workout/strength tracker** as the first page — log sets, visualize progress, mobile-friendly for gym use
- **Generic read-only SQL endpoint** (`POST /query`) for ad-hoc chart queries and agent consumption
- **Modern linting/formatting** — fast, enforces React/TS/Refine patterns
- **Claude Code enablement** — rules, CLAUDE.md, conventions so future pages are a single prompt away
- **Dark/light mode** with system preference detection + manual toggle
- **Mobile-responsive** — especially the workout tracker (primary gym use case)

## Non-Goals

- Authentication beyond existing API bearer token (Tailscale-only, no user accounts)
- Other dashboard pages (Docker, TickTick, Slack, etc.) — future work
- Real-time/WebSocket data
- SSR or Next.js — static Vite build served by nginx

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Tailscale device (browser / phone)                 │
│  dashboard.jkrumm.com ──→ Caddy :443               │
│  api.jkrumm.com       ──→ Caddy :443               │
└──────────────────────────┬──────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                │
   dashboard:80      api:4000              │
   (nginx/static)    (Elysia/Bun)          │
                          │                │
                     SQLite DB             │
                  /app/data/homelab.db     │
```

### Monorepo Structure

```
homelab/
├── package.json              # Bun workspace root
├── packages/
│   ├── api/                  # Existing API (moved from api/)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── db/           # NEW: Drizzle schema + migrations
│   │   │   ├── routes/       # Existing + new CRUD routes
│   │   │   └── clients/      # Existing external API clients
│   │   ├── Dockerfile
│   │   └── package.json
│   └── dashboard/            # NEW: Refine v5 app
│       ├── src/
│       │   ├── App.tsx
│       │   ├── providers/    # Refine data provider (Eden Treaty)
│       │   ├── pages/        # Dashboard pages
│       │   └── components/   # Shared chart/form components
│       ├── Dockerfile        # Multi-stage: bun build → nginx
│       └── package.json
├── docker-compose.yml        # Updated with dashboard service
├── Caddyfile                 # Updated with dashboard route
└── .env.tpl                  # Unchanged
```

- **Bun workspaces** link `packages/api` and `packages/dashboard`
- **Eden Treaty** in dashboard imports API types at build time — full type safety, no codegen
- **Runtime**: two separate containers, communicate over HTTP (Docker network)
- **Database**: SQLite at `/app/data/homelab.db` on existing API volume

### Key Decisions

- **Eden Treaty over simple-rest**: Custom Refine data provider wrapping Eden Treaty. More initial work, but type errors caught at compile time. Future pages get type safety for free.
- **Recharts**: Most LLM training data of any React chart library (13M+ weekly npm downloads). Component-based JSX API maps naturally to code generation.
- **Generic `/query` endpoint**: SELECT-only SQL execution. Enables ad-hoc chart queries without needing bespoke endpoints for every visualization. Safe behind Tailscale + bearer auth.
- **Mobile-first workout form**: The workout tracker is primarily used at the gym on a phone. Form layout must work well on small screens. Charts can be secondary on mobile.

## Data Model

### workouts

| Column     | Type       | Notes                                     |
| ---------- | ---------- | ----------------------------------------- |
| id         | INTEGER PK | Auto-increment                            |
| date       | TEXT       | ISO date (YYYY-MM-DD)                     |
| exercise   | TEXT       | bench_press / deadlift / squat / pull_ups |
| notes      | TEXT       | Optional session notes                    |
| created_at | TEXT       | ISO timestamp                             |

### workout_sets

| Column     | Type       | Notes                                |
| ---------- | ---------- | ------------------------------------ |
| id         | INTEGER PK | Auto-increment                       |
| workout_id | INTEGER FK | References workouts.id               |
| set_number | INTEGER    | Order within workout                 |
| set_type   | TEXT       | warmup / work / drop                 |
| weight_kg  | REAL       | For pull-ups: additional weight only |
| reps       | INTEGER    | Rep count                            |
| created_at | TEXT       | ISO timestamp                        |

### Computed Values (not stored)

- **Total load (pull-ups)**: weight_kg + 70 (constant bodyweight)
- **Estimated 1RM (Epley)**: weight × (1 + reps/30)
- **Estimated 1RM (Brzycki)**: weight × 36 / (37 - reps)
- **Average 1RM**: mean of Epley and Brzycki
- **Volume**: weight × reps (per set), sum per workout

## Workout Tracker Page

### Desktop Layout (≥768px)

- **Left 3/4**: Recharts visualizations
  - 1RM trend over time (line chart, per exercise)
  - Volume per session (bar chart)
  - Max weight progression (line chart)
  - Exercise comparison view
- **Right 1/4**: Workout log form
  - Exercise selector (dropdown)
  - Date picker (defaults to today)
  - Dynamic set list: add/remove sets, each with type dropdown + weight + reps
  - Submit button

### Mobile Layout (<768px)

- **Stacked**: Form on top (primary use case at gym), charts below
- Form should be optimized for quick data entry between sets
- Large touch targets for weight/rep inputs

### Filters & Metrics

- Exercise filter (multi-select or tabs)
- Date range selector
- Summary cards: current estimated 1RM, best 1RM, total volume (week/month), session count

## REST API Conventions (Refine simple-rest compatible)

New CRUD routes follow these conventions so the Eden Treaty data provider maps cleanly:

- `GET /workouts` → list (supports `_start`, `_end`, `_sort`, `_order`, field filters)
- `GET /workouts/:id` → single record
- `POST /workouts` → create (body = record data)
- `PATCH /workouts/:id` → update (body = partial record)
- `DELETE /workouts/:id` → delete
- Response headers: `x-total-count` for list pagination
- Same pattern for `/workout-sets`

## Deployment

- **Dashboard container**: multi-stage Dockerfile (Bun install + build → nginx:alpine serve)
- **Docker Compose**: new `dashboard` service, exposed on internal port 80
- **Caddy**: `dashboard.jkrumm.com` HTTPS site block (Tailscale-only, no cloudflared variant)
- **API container**: Dockerfile updated for monorepo context (build from workspace root or packages/api)

---

## Ralph Groups

> **Agent autonomy note**: Each group is executed by an autonomous agent. The agent should research current best practices independently, use the references below as starting points (not hard constraints), and make implementation decisions on its own. No questions back — move forward with the best judgment. Use `/research` skill when unsure about library versions, APIs, or patterns.

### Group 1: Monorepo + Database Foundation

**Scope**: Restructure into Bun monorepo, add Drizzle + SQLite to API, generic query endpoint.

**Tasks**:

- Create root `package.json` with Bun workspaces (`packages/*`)
- Move `api/` → `packages/api/`, update all paths (Dockerfile, docker-compose volume mounts, imports)
- Add `drizzle-orm` + `drizzle-kit` to API
- Create `packages/api/src/db/schema.ts` with workouts + workout_sets tables
- Create `packages/api/src/db/index.ts` — DB connection using `bun:sqlite`, Drizzle instance
- Run initial migration (drizzle-kit generate + push, or create migration script)
- Add `POST /query` endpoint — accepts SQL string, validates SELECT-only, returns JSON rows
- Update API Dockerfile for monorepo context
- Verify existing API endpoints still work after restructure

**Acceptance**: `bun install` from root works, API starts, SQLite DB created, `/query` returns results, existing endpoints unaffected.

**References**: Bun workspace docs, Drizzle ORM SQLite guide, existing `api/src/index.ts` structure.

### Group 2: Workout REST API

**Scope**: CRUD endpoints for workouts and workout_sets, Refine-compatible conventions.

**Depends on**: Group 1 (DB schema + Drizzle instance)

**Tasks**:

- Create `packages/api/src/routes/workouts.ts` — full CRUD with Refine pagination/sort/filter conventions
- Create `packages/api/src/routes/workout-sets.ts` — full CRUD
- Implement `x-total-count` response header for list endpoints
- Add computed fields on read: 1RM (Epley + Brzycki), total volume, total load for pull-ups
- Wire routes into main `index.ts` behind auth guard
- Add TypeBox validation schemas for all request/response bodies

**Acceptance**: All CRUD operations work via curl/httpie, pagination + sorting + filtering work, computed 1RM values returned on workout reads.

**References**: Existing route patterns in `packages/api/src/routes/`, Refine simple-rest data provider conventions, Elysia TypeBox validation.

### Group 3: Dashboard Scaffold + Deployment

**Scope**: Refine v5 app with Ant Design, theme switching, sidebar nav, Docker + Caddy deployment.

**Can run in parallel with**: Groups 1 + 2 (no API dependency for scaffold)

**Tasks**:

- Create `packages/dashboard/` — Vite + React 19 + Refine v5 + Ant Design v5
- Install: `@refinedev/core`, `@refinedev/antd`, `@refinedev/react-router`, `recharts`, `antd`
- Configure Ant Design ConfigProvider with dark/light theme switching (system pref + manual toggle in header)
- Set up Refine app shell with sidebar navigation (Sider layout)
- Add placeholder nav items: Strength Tracker (active), Docker (disabled), Monitoring (disabled), Tasks (disabled)
- Create `packages/dashboard/Dockerfile` (multi-stage: bun build → nginx:alpine)
- Add `dashboard` service to `docker-compose.yml`
- Add `dashboard.jkrumm.com` to Caddyfile (HTTPS, Tailscale-only)
- Mobile-responsive layout foundation (Ant Design Grid breakpoints)

**Acceptance**: Dashboard builds, container starts, Caddy routes to it, sidebar renders, theme toggle works on desktop and mobile.

**References**: Refine v5 quickstart, Ant Design v5 theme customization, existing Caddyfile patterns.

### Group 4: Eden Treaty Data Provider + Workout Page

**Scope**: Wire dashboard to API via Eden Treaty, build the workout tracker page with charts and form.

**Depends on**: Groups 1 + 2 + 3

**Tasks**:

- Install `@elysiajs/eden` in dashboard package
- Create custom Refine data provider wrapping Eden Treaty (`packages/dashboard/src/providers/data-provider.ts`)
- Map Refine CRUD operations (getList, getOne, create, update, deleteOne) to Eden Treaty calls
- Handle pagination params, sorting, filtering translation
- Build workout tracker page:
  - Split layout: 3/4 charts + 1/4 form (desktop), stacked form-first (mobile)
  - Recharts: 1RM trend line, volume bar chart, max weight progression
  - Workout form: exercise dropdown, date picker, dynamic add-set with type/weight/reps
  - Summary metric cards (current 1RM, best 1RM, volume this week/month)
  - Exercise filter tabs, date range selector
- Wire everything to live API data

**Acceptance**: Can log a workout via form, data persists in SQLite, charts render workout history, layout is usable on mobile.

**References**: Eden Treaty docs, Refine data provider interface, Recharts examples.

### Group 5: Linting + Claude Code Enablement

**Scope**: Modern linting/formatting setup, Claude Code rules and documentation.

**Depends on**: Groups 3 + 4 (needs final project structure)

**Tasks**:

- Set up **oxlint** (linting) + **oxfmt** (formatting) for the monorepo
  - Research and enable the most useful rule categories/plugins for: Elysia, Vite, React v19, Ant Design, Refine v5
  - Include TypeScript strict rules, React hooks rules, import ordering, accessibility basics
  - Formatting config: match existing API conventions (check current code for tabs/spaces, quotes, semicolons)
  - `bun lint` and `bun format` scripts in root package.json
  - `bun lint:fix` for auto-fixable rules
- Create `packages/dashboard/CLAUDE.md`:
  - Project structure and conventions
  - How to add a new Refine resource end-to-end (schema → route → resource → page)
  - Data provider setup (Eden Treaty)
  - Chart patterns (Recharts conventions)
  - Theme system usage
- Create `.claude/rules/refine.md`:
  - Refine v5 + Ant Design patterns
  - Data provider wiring via Eden Treaty
  - Recharts conventions
  - Mobile-responsive layout patterns
- Update root `CLAUDE.md` with monorepo structure changes

**Acceptance**: `bun lint` and `bun format` (oxlint + oxfmt) work from root with zero warnings on existing code, Claude Code rules are comprehensive enough that prompting "add a Docker containers dashboard page" would produce a working result.

**References**: Current `.claude/rules/` patterns, existing `CLAUDE.md` structure, Refine v5 docs.

## Success Criteria

- [ ] Bun monorepo with workspace linking works (`bun install` from root)
- [ ] `dashboard.jkrumm.com` loads Refine app with sidebar navigation (Tailscale only)
- [ ] Dark/light mode toggle works + respects system preference
- [ ] Eden Treaty provides type-safe API calls from dashboard
- [ ] Workout form: select exercise, add sets with type/weight/reps, submit saves to SQLite
- [ ] Charts show workout history: 1RM trend, volume per session, max weight progression
- [ ] Mobile layout is usable for logging workouts at the gym
- [ ] `POST /query` executes read-only SQL and returns JSON
- [ ] Existing API endpoints unaffected
- [ ] oxlint + oxfmt enforced across monorepo with zero warnings
- [ ] Claude Code rules enable generating a new dashboard page in a single prompt
