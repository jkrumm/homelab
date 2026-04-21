# RALPH Notes — Strength Tracker v2

Learning notes appended by Claude after each group. Institutional memory — surprising discoveries,
library quirks, deviations from the prompt, deferred work. Future you will read this.

Previous loop (dashboard scaffold, 2026-04-16) archived under
`docs/ralph/archive/dashboard-scaffold-2026-04-16/`.

---

## Group 1: Schema Foundation

### What was implemented
Added the `exercises` reference table with 4 seeded rows (bench_press, squat, deadlift, pull_ups), migrated `workouts.exercise` → `exercise_id`, added `rir INTEGER` to workouts, added `amrap` set type, rewrote `estimate1RM` with Brzycki/Epley validity gates (reps ≤ 10 both, 11-12 Epley only, > 12 returns null), and wired up the `useBodyWeight` / `bodyWeight` resolution chain (weight_log → user_profile goal_weight → 80 kg fallback).

### Deviations from prompt
- Did not drop-and-recreate workouts table; instead used `ALTER TABLE workouts RENAME COLUMN exercise TO exercise_id` + `ALTER TABLE workouts ADD COLUMN rir INTEGER` in try/catch blocks, which preserves the 2 existing rows while being safe to re-run.
- The `computeWorkoutMetrics` signature now takes optional `bodyweightKg` instead of a curried bodyweight function, since the call sites all have the value readily. Return type now includes `best1rmSet` (nullable) and `estimated1rm` is `number | null` (was always `number`).
- `use-exercises.ts` was added as a bonus (not explicitly in prompt), since `constants.ts` now imports from `VX` tokens which creates a dep on `charts/tokens`. The hook provides the API-backed list with compile-time fallback.
- `daily_metrics.weight_kg` is not in the current schema; step 2 of the bodyweight resolution chain is intentionally skipped (comment in `body-weight.ts`).

### Gotchas & surprises
- `oxlint` enforces `===` over `==` — `rir == null` must be `rir === null || rir === undefined`. Caught during lint pass.
- Refine v5 `useOne` returns `{ result, query }` (same pattern as `useList`), NOT `{ data }`. The error message from TypeScript made this clear: `Property 'data' does not exist on type '{ result: T | undefined; query: ... }'`.
- `oxfmt` reformatted the ternary chain in `use-exercises.ts` to nested format — harmless but worth knowing.
- Drizzle `leftJoin` in `.select({ cols })` form works fine; the result row type is correctly inferred with `exercises.name` being `string | null` (because LEFT JOIN).

### Commit notes
Committed cleanly in two commits: `feat(api): ...` then `feat(dashboard): ...`.

### Future improvements
- The `useBodyWeight` hook fetches weight-log on every component mount that uses it; consider lifting it to a context or Refine's stale-while-revalidate cache once Groups 2-4 are in place and usage is clearer.
- `achievements.ts` still computes bodyweight for pull-ups with a hard-coded 80 kg constant — it should eventually accept the `useBodyWeight` result, but this is a UX detail and not blocking.
- The `exercises` reference table is seeded at startup via `INSERT OR IGNORE`; once Group 1 data is stable, a future group could expose a CRUD admin for managing exercises beyond the 4 defaults.

---

## Group 2: Visx Migration & Strength Trajectory

### What was implemented
Deleted `charts.tsx` (Recharts `MainChart`, `AreaMetricChart`, `FrequencyChart`). Created `visx-charts.tsx` with:
- `OneRmTrendChartInner` / `OneRmTrendChart`: multi-series e1RM lines per exercise, 30-day MA dashed overlay, PR dots with 1.5s fade-in animation, best-ever reference lines per lift, crosshair + hover dots via `useHoverSync`.
- `StrengthCompositeChartInner` / `StrengthCompositeChart`: three z-score series (velocity f', tonnage growth, INOL) on a shared σ axis, exercise selector in header, sigma chips as header extra.

Added analytics functions to `utils.ts`: `velocityPctPerDay`, `strengthDirection`, `sessionInol`, `weeklyWorkVolume`, `tonnageGrowthRatio`, `buildOneRmChartData`, `buildCompositeData`, plus private helpers `sampleStdDevInternal`, `linearReg`, `movingAvgIndex`, `dateBasedMA`, `extractBestSet`, `velocityAtDate`.

Added `METRIC_TOOLTIPS` to `constants.ts`. Rewired `index.tsx` with `HoverContext.Provider`, section structure (Section 1 live, Sections 2–4 placeholder cards), removed stale ST_KEYS from `use-local-state.ts`.

### Deviations from prompt
- `bestEver` computed locally in `OneRmTrendChart` (from workouts prop) rather than derived from chart data, since `buildOneRmChartData` is date-range filtered and could miss historical all-time PRs.
- `OneRmPoint.e1rm` / `ma` / `bestSets` typed as `Record<string, T | null>` (not `undefined`) to satisfy `eqeqeq` lint + TypeScript narrowing simultaneously. `buildOneRmChartData` explicitly fills `null` for every `exerciseId` on every date point.

### Gotchas & surprises
- `oxlint eqeqeq` rejects `!= null` — the TypeScript idiomatic "check both null and undefined" pattern. Must use `!== null` strictly. This means `Record<string, T | undefined>` + `!== null` won't narrow away undefined; fix by using `null` throughout.
- `useMemo` is technically side-effect-free but was used as a sync-after-render mechanism for `selectedExercise` reset when `activeExercises` changes. Works in practice because Strict Mode double-invokes it.
- `dim()` for `OneRmTrendChart` must check `activeExercises.includes(highlighted)` before dimming — if 'ma' or 'pr' legend item is highlighted, all exercise lines should stay at full opacity.

### Future improvements
- `buildCompositeData` velocity calculation uses a separate `velocityAtDate` call per session — could be unified into a single regression pass if performance becomes an issue on large datasets.
- Best-ever reference lines use all-time workouts (not date-filtered) by design; this is correct for "have you beaten your record" context.

---
