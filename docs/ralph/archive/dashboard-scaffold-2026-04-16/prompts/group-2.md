# Group 2: Workout REST API

## What You're Doing

Build full CRUD REST endpoints for workouts and workout sets, following conventions compatible with Refine's `simple-rest` data provider. After this group, you can create, read, update, and delete workouts and sets via the API, with proper pagination, sorting, filtering, and computed 1RM values.

---

## Research & Exploration First

1. Read `packages/api/src/routes/` — at least 2-3 existing route files to understand patterns (TypeBox schemas, Elysia plugin structure, response formatting)
2. Read `packages/api/src/db/schema.ts` — the Drizzle schema from Group 1
3. Read `packages/api/src/db/index.ts` — how to access the DB instance
4. Read `packages/api/src/index.ts` — how routes are registered with auth guard
5. Research Refine `simple-rest` data provider conventions:
   - How does it send pagination params? (`_start`/`_end` or `_page`/`_perPage`?)
   - How does it send sort params? (`_sort`/`_order`?)
   - How does it send filters? (field-name query params?)
   - What response headers does it expect? (`x-total-count`?)
   - How does it handle `getList`, `getOne`, `create`, `update`, `deleteOne`?
6. Research Elysia best practices for CRUD routes — guards, groups, shared validation

---

## What to Implement

### 1. Workout routes (`packages/api/src/routes/workouts.ts`)

Elysia plugin exporting all workout CRUD routes:

- `GET /workouts` — List with pagination, sorting, filtering
  - Query params: `_start`, `_end`, `_sort`, `_order`, `exercise` (filter), `date_from`, `date_to`
  - Response: array of workouts with computed fields
  - Header: `x-total-count` with total matching records
  - Each workout includes nested sets (eager load) and computed metrics:
    - `estimated_1rm_epley`: max across work sets using `weight × (1 + reps/30)`
    - `estimated_1rm_brzycki`: max across work sets using `weight × 36 / (37 - reps)`
    - `estimated_1rm`: average of Epley and Brzycki
    - `total_volume`: sum of (weight × reps) across all sets
    - For pull-ups: use `weight_kg + 70` as effective weight in all calculations

- `GET /workouts/:id` — Single workout with sets and computed fields

- `POST /workouts` — Create workout
  - Body: `{ date, exercise, notes?, sets: [{ set_number, set_type, weight_kg, reps }] }`
  - Creates workout + all sets in a transaction
  - Returns created workout with id

- `PATCH /workouts/:id` — Update workout
  - Body: partial workout fields (date, exercise, notes)
  - Does NOT update sets (sets have their own endpoints)

- `DELETE /workouts/:id` — Delete workout + cascade delete sets

### 2. Workout set routes (`packages/api/src/routes/workout-sets.ts`)

- `GET /workout-sets` — List with filters (`workout_id` required or optional)
- `POST /workout-sets` — Create single set
- `PATCH /workout-sets/:id` — Update set
- `DELETE /workout-sets/:id` — Delete set

### 3. TypeBox validation schemas

Define proper schemas for all request bodies and responses. Use TypeBox `t.Object`, `t.String`, `t.Number`, etc. Validate:

- `exercise` is one of: `bench_press`, `deadlift`, `squat`, `pull_ups`
- `set_type` is one of: `warmup`, `work`, `drop`
- `weight_kg` is positive number
- `reps` is positive integer
- `date` matches YYYY-MM-DD format

### 4. Register routes

Wire both route plugins into `packages/api/src/index.ts` behind the auth guard, same pattern as existing routes.

---

## Validation

```bash
cd packages/api && bun tsc --noEmit

# Start API and test CRUD
cd packages/api && bun run src/index.ts &
sleep 2

# Create a workout
curl -s -X POST http://localhost:4000/workouts \
  -H "Authorization: Bearer test" \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-01-15","exercise":"bench_press","sets":[{"set_number":1,"set_type":"warmup","weight_kg":60,"reps":10},{"set_number":2,"set_type":"work","weight_kg":80,"reps":5}]}'

# List workouts (check x-total-count header)
curl -sI http://localhost:4000/workouts -H "Authorization: Bearer test"

# Get single workout (check computed 1RM fields)
curl -s http://localhost:4000/workouts/1 -H "Authorization: Bearer test"

kill %1
```

Verify:

- All CRUD operations work
- Pagination with `_start`/`_end` returns correct slices
- `x-total-count` header present on list responses
- Computed 1RM values are correct (manual calculation check)
- Pull-ups use weight_kg + 70 for effective weight
- TypeBox validation rejects invalid input (wrong exercise name, negative weight)

---

## Commit

```
feat(api): add workout and workout-set CRUD endpoints with Refine-compatible REST conventions
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 2
```
