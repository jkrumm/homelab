# Group 1 — Schema Foundation

## What You're Doing

Swap the v1 string-enum exercise model for a real `exercises` reference table, add `rir` to
workouts, add `amrap` as a set_type, wire up dynamic bodyweight lookup for pull-ups, and tighten
the `estimate1RM` function per the validity gates in `STRENGTH-ANALYTICS.md` §2.2. This is
schema + utility work — no chart changes. After this group the app still runs on v1 visuals, but
the data foundation is ready for the visx rewrite.

The app is greenfield. You have ~2 real workouts on disk. There is no migration to preserve.
A DROP + CREATE + re-seed is acceptable if it simplifies things.

---

## Research & Exploration First

1. Read `docs/STRENGTH-ANALYTICS.md` end-to-end. Pay special attention to Part 1 (schema design),
   §2.2 (e1RM validity gates), §2.4 (relative strength), and Part 7 Group 1 (the phase boundary).
2. Read `packages/api/src/db/{schema,index}.ts` — understand the existing table shapes and the
   `CREATE TABLE IF NOT EXISTS` idiom used.
3. Read `packages/api/src/routes/workouts.ts` and `workout-sets.ts` — these are the CRUD routes
   you'll update.
4. Read `packages/dashboard/src/pages/strength-tracker/{types,constants,utils,workout-form}.tsx`
   — understand the v1 exercise handling and the `PULL_UPS_BODYWEIGHT = 70` constant you're
   replacing.
5. Read the weight-log route (`packages/api/src/routes/weight-log.ts`) and daily-metrics route
   — these feed the bodyweight fallback chain.

---

## What to Implement

### 1. Schema additions (`packages/api/src/db/schema.ts` + `db/index.ts`)

- Add `exercises` table:
  ```ts
  export const exercises = sqliteTable('exercises', {
    id: text('id').primaryKey(),                      // "bench_press" | "squat" | "deadlift" | "pull_ups"
    name: text('name').notNull(),                     // "Bench Press"
    category: text('category').notNull(),             // "push" | "pull" | "legs" | "hinge"
    muscle_group: text('muscle_group').notNull(),     // "chest" | "back" | "quads" | "glutes" | "posterior"
    is_bodyweight: integer('is_bodyweight').default(0),
    display_order: integer('display_order').default(0),
  })
  ```
- Add `rir INTEGER` column to `workouts` (nullable, 0–5). Existing rows: null.
- `set_type` on `workout_sets` remains TEXT — no SQL constraint change needed. The set types are
  now `"warmup" | "work" | "drop" | "amrap"` — validate in the route TypeBox schema, not at DB
  level.
- Drop (or leave) the old text-valued `exercise` column on `workouts`. Cleanest: replace it with
  `exercise_id TEXT NOT NULL`. Since the app is greenfield, a DROP + recreate is acceptable; write
  a one-off SQL snippet in `db/index.ts` that copies the 4 existing exercise keys over before
  dropping.
- Seed the 4 reference rows on first startup: bench_press / deadlift / squat / pull_ups — with
  display_order 1–4. Use `INSERT OR IGNORE` so re-runs are safe.

### 2. `GET /exercises` route

Create `packages/api/src/routes/exercises.ts`. Read-only. Returns the seeded rows sorted by
`display_order`. Shape:
```ts
[{ id, name, category, muscle_group, is_bodyweight, display_order }]
```
Register behind the auth guard in `packages/api/src/index.ts` the same way as the other routes.

### 3. Update `workouts` + `workout-sets` routes

- Rename/migrate the `exercise` field on the workouts route to `exercise_id`. Validate against
  the TypeBox schema (TypeBox `t.String()` is fine — we don't need a runtime whitelist because
  foreign-key semantics are enforced at read-time via joins).
- Add `rir: t.Optional(t.Integer({ minimum: 0, maximum: 5 }))` to the POST/PATCH body schemas.
- Add `amrap` to the allowed `set_type` union on the workout-sets route.
- The `GET /workouts` response should include the joined exercise name and `is_bodyweight` flag
  for convenience (saves an N+1 on the dashboard). Use Drizzle's `leftJoin` or a subquery.

### 4. Dashboard types / constants / data provider

- Update `packages/dashboard/src/pages/strength-tracker/types.ts`:
  - `Workout.exercise: ExerciseKey` → `Workout.exercise_id: string` (drop the enum, accept any
    string — exercises are reference data now).
  - Add `Workout.rir: number | null`.
  - Add `SetType = 'warmup' | 'work' | 'drop' | 'amrap'`.
  - Add an `Exercise` interface mirroring the DB row.
- Update `constants.ts`:
  - Replace the hardcoded `EXERCISES` array with a fetch from `/exercises`. For now, keep the
    hardcoded list as a compile-time fallback, but add a `useExercises()` hook under
    `src/pages/strength-tracker/` that reads from the API and caches via Refine's `useList`.
  - Delete `PULL_UPS_BODYWEIGHT = 70`.
  - Move `EXERCISE_COLORS` from raw hex into `VX.series.*` tokens in
    `packages/dashboard/src/charts/tokens.ts`. Add:
    ```
    VX.series.benchPress  = '#1677ff'
    VX.series.squat       = '#52c41a'
    VX.series.deadlift    = '#ff4d4f'
    VX.series.pullUps     = '#fa8c16'
    ```
    (These happen to be the same hex values the v1 used — intentional, preserves the user's
    mental model of per-lift colors.)
    Then build a `colorForExercise(id: string)` helper that maps exercise keys to tokens.
- Update `data-provider.ts` — add a case for `resource === 'exercises'` (simple read-through).

### 5. Dynamic bodyweight helper

Create `packages/dashboard/src/pages/strength-tracker/body-weight.ts` exporting:

```ts
export function bodyWeight(
  date: string,
  sources: { weightLog: WeightLogEntry[]; dailyMetrics: DailyMetric[]; profileDefault: number }
): number
```

Resolution order (matches §1.3 of the analytics doc):
1. Nearest `weight_log` entry on-or-before `date`
2. Nearest `daily_metrics.weight_kg` on-or-before `date` (Garmin scale syncs here) — note: the
   current `daily_metrics` schema may not include `weight_kg`; if not, skip this step
3. `profileDefault` from `user_profile` (if present, else 80 as a hard fallback)

Hook wrapper: `useBodyWeight()` returns a `(date: string) => number` curried helper that pulls
weight-log + daily-metrics + user-profile via Refine's `useList`/`useOne`.

### 6. Tighten `estimate1RM` (`utils.ts`)

Rewrite per `STRENGTH-ANALYTICS.md` §2.2:

- Drop `mayhew`. The function signature stays the same.
- Brzycki valid for reps ∈ [1, 10]. Epley valid for reps ∈ [1, 12].
- Both valid → average. Only Brzycki valid → Brzycki. Only Epley valid → Epley. **Return `null`
  if reps > 12.**
- Add a new function `eligibleForE1RM(set, workoutRir): boolean` — returns true when:
  - `set_type ∈ {'work', 'amrap'}`
  - `reps ∈ [1, 12]`
  - `workoutRir === null || workoutRir ≤ 3`
- Update `computeWorkoutMetrics` to only consider eligible sets for `best e1RM`, with the
  best-producing set stored alongside (return `{ maxWeight, estimated1rm, best1rmSet, totalVolume }`).
- Replace all `PULL_UPS_BODYWEIGHT` usage with the dynamic bodyweight helper. For server-side
  computation where no bodyweight context is available, fall back to `user_profile` default; if
  that's also null, fall back to 80 kg as a hard-coded constant (document in a comment).

### 7. Update `workout-form.tsx` minimally

- Add a RIR input (number 0–5, optional) at the bottom of the form next to the Notes field.
- Add `amrap` to the set-type dropdown in `set-editor.tsx`.
- **Do not redesign the form.** The layout, auto-load-last-session, and submit UX all stay as-is.

### 8. Existing charts keep working

The v1 `charts.tsx` still renders after this group. That's fine — it's Group 2's job to replace
it. You'll need to update the v1 chart code to read `workout.exercise_id` instead of
`workout.exercise` everywhere. That's it.

---

## Validation

```bash
# From repo root
bun install
bun run lint
cd packages/api && bun tsc --noEmit
cd packages/dashboard && bun tsc --noEmit
bun run format:check    # if the script exists
```

Then start the dev server: `cd packages/dashboard && VITE_API_URL=https://api.jkrumm.com bun run dev`
and manually verify:
- Page loads.
- Old charts render (on the v1 data — they will look exactly like before).
- Workout form saves with an optional RIR value.
- New form field for `amrap` set type works.
- No console errors.

---

## Commit

```bash
# Two commits — API changes first, dashboard changes second
git add packages/api
git -c commit.gpgsign=false commit --no-verify -m "feat(api): exercises reference table, RIR on workouts, amrap set type"

git add packages/dashboard
git -c commit.gpgsign=false commit --no-verify -m "feat(dashboard): dynamic bodyweight, tightened e1RM gate, amrap + RIR UI"
```

If either commit fails, follow the fallback in `shared-context.md` (record in `RALPH_NOTES.md`
and continue).

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then emit:

```
RALPH_TASK_COMPLETE: Group 1
```
