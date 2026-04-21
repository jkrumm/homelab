# Group 4: Eden Treaty Data Provider + Workout Tracker Page

## What You're Doing

Wire the dashboard to the API via Eden Treaty for type-safe data fetching, then build the full workout tracker page with charts and form. After this group, you can log workouts via the form, see them persist in SQLite, and visualize progress with Recharts — on both desktop and mobile.

---

## Research & Exploration First

1. Read `packages/api/src/index.ts` — the full Elysia app to understand its type export
2. Read `packages/api/src/routes/workouts.ts` — the CRUD endpoints from Group 2
3. Read `packages/api/src/routes/workout-sets.ts` — set endpoints
4. Read `packages/dashboard/src/App.tsx` — current app shell from Group 3
5. Read `packages/dashboard/src/` directory — understand the scaffold structure
6. Research **Eden Treaty** (Elysia's type-safe client):
   - How to set up Eden Treaty in a separate package that imports Elysia app types
   - How to configure base URL and headers (bearer token)
   - How Eden Treaty handles GET/POST/PATCH/DELETE
   - How to export the Elysia app type for cross-package consumption
7. Research **Refine data provider interface**:
   - What methods must a custom data provider implement? (`getList`, `getOne`, `create`, `update`, `deleteOne`, etc.)
   - How does Refine pass pagination, sort, and filter params?
   - How does Refine expect responses to be formatted?
8. Research **Recharts** components:
   - `LineChart`, `BarChart`, `ResponsiveContainer`, `Tooltip`, `Legend`
   - How to make charts responsive
   - Best practices for time-series data

---

## What to Implement

### 1. Eden Treaty setup

- Export the Elysia app type from `packages/api/src/index.ts` (e.g., `export type App = typeof app`)
- Install `@elysiajs/eden` in `packages/dashboard`
- Create Eden Treaty client in `packages/dashboard/src/providers/eden.ts`:
  - Import the app type from `@homelab/api` (workspace dependency)
  - Configure base URL (env var `VITE_API_URL`, defaults to `https://api.jkrumm.com`)
  - Configure bearer token header (env var `VITE_API_TOKEN`)

### 2. Custom Refine data provider

Create `packages/dashboard/src/providers/data-provider.ts`:

- Implement Refine's `DataProvider` interface using Eden Treaty under the hood
- Map Refine operations to API calls:
  - `getList` → `GET /<resource>` with `_start`, `_end`, `_sort`, `_order`, filter params; parse `x-total-count` header for total
  - `getOne` → `GET /<resource>/:id`
  - `create` → `POST /<resource>` with body
  - `update` → `PATCH /<resource>/:id` with body
  - `deleteOne` → `DELETE /<resource>/:id`
- Handle the resource name → API path mapping (e.g., Refine resource `workouts` → `/workouts`)
- Error handling: convert API errors to Refine-compatible format

### 3. Workout tracker page — Form (right panel)

Create `packages/dashboard/src/pages/strength-tracker/index.tsx` (or similar structure):

**Form component** (`WorkoutForm` or similar):

- Exercise selector: dropdown with bench_press, deadlift, squat, pull_ups (display-friendly labels)
- Date picker: defaults to today
- Dynamic set list:
  - "Add Set" button appends a new row
  - Each row: set_type dropdown (warmup/work/drop), weight_kg number input, reps number input, delete button
  - Auto-increment set_number
  - Sensible defaults (work type, last used weight)
- Submit button: creates workout + sets via Refine's `useCreate` hook
- Success feedback: clear form, show notification
- Mobile-optimized: large touch targets, stacked inputs

### 4. Workout tracker page — Charts (left panel)

**Chart components** using Recharts:

- **1RM Trend** (LineChart):
  - X axis: date
  - Y axis: estimated 1RM (kg)
  - One line per exercise (color-coded)
  - Tooltip showing date, exercise, 1RM value
  - Use `estimated_1rm` from API response (average of Epley + Brzycki)

- **Volume per Session** (BarChart):
  - X axis: date
  - Y axis: total volume (kg)
  - Stacked or grouped by exercise
  - Tooltip with breakdown

- **Max Weight Progression** (LineChart):
  - X axis: date
  - Y axis: max weight used in work sets
  - Per exercise

- **Summary Cards** (Ant Design `Card` + `Statistic`):
  - Current estimated 1RM (latest workout per exercise)
  - Personal best 1RM (all time per exercise)
  - Total volume this week
  - Workout count this month

### 5. Page layout

- Desktop (≥768px): CSS Grid or Ant Design `Row`/`Col` — 3/4 charts, 1/4 form
- Mobile (<768px): stacked — form on top (primary gym use), charts below
- Filter bar above charts: exercise multi-select tabs, date range picker
- Charts fetch data via Refine's `useList` hook or custom `useQuery` with the `/query` endpoint for complex aggregations

### 6. Wire into Refine

- Register `workouts` and `workout-sets` as Refine resources in `App.tsx`
- Set up routes: `/strength-tracker` renders the workout tracker page
- Replace placeholder data provider with Eden Treaty provider

---

## Validation

```bash
# Typecheck both packages
cd packages/api && bun tsc --noEmit
cd packages/dashboard && bun tsc --noEmit

# Build dashboard
cd packages/dashboard && bun run build
```

Manual verification (describe what should work):

- Form renders with exercise dropdown, date picker, and set inputs
- Adding/removing sets works dynamically
- Submitting a workout saves to SQLite via API
- Charts render (may need seed data — use the form or curl to create a few workouts)
- Mobile layout stacks form above charts
- Theme toggle still works with charts (Recharts respects theme colors)

---

## Commit

```
feat(dashboard): add Eden Treaty data provider with type-safe API integration

feat(dashboard): implement workout tracker page with charts and form
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 4
```
