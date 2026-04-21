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

## Group 3: Load Quality & Efficiency

### What was implemented

Added to `utils.ts`: `ewmaSeries` (internal EWMA helper), `weeklyTonnageSeries`, `computeAcwrSeries` + `AcwrResult`, `volumeLandmarks` + `VolumeLandmarks`, `buildWeeklyVolumeData` + `WeeklyVolumePoint`, `buildAcwrChartData` + `AcwrChartPoint`, `buildInolChartData` + `InolChartPoint`, `buildMomentumChartData` + `MomentumPoint`.

Added to `types.ts`: `AcwrZone = 'undertrained' | 'optimal' | 'caution' | 'danger'`.

Added to `constants.ts`: `acwrZoneColor`, `acwrZoneLabel`, `inolDotColor`, and four new `METRIC_TOOLTIPS` entries (`weeklyVolume`, `trainingLoad`, `inol`, `momentum`).

Added to `visx-charts.tsx`:
- `WeeklyVolumeChart`: uses `Bars` kind, stacked set-type breakdown (warmup/work/drop/amrap), 4-week MA line overlay, MEV/MAV/MRV ref lines from `volumeLandmarks`.
- `TrainingLoadChart` + `TrainingLoadChartInner`: bespoke multi-series ACWR lines with `ZoneRects` zone backgrounds (undertrained/optimal/caution/danger), per-exercise lines via `LinePath`, dashed threshold lines.
- `InolChart` + `InolChartInner`: scatter dots colored by INOL zone (`inolDotColor`), 10-session MA line, `ZoneRects` zone backgrounds.
- `MomentumChart` + `MomentumChartInner`: bespoke dual-panel (65/35 split); top panel = e1RM scatter dots + 8-session MA line; bottom panel = velocity bars (green/red by sign).

Updated `index.tsx` Section 2 (Load Quality) and Section 3 (Efficiency & Momentum) — removed placeholder `Card` elements.

### Deviations from prompt

- MEV/MAV/MRV computed as tonnage percentiles (p25/p50/p90) rather than set-count percentiles. The chart Y-axis is in tonnage units, making set-count reference lines dimensionally inconsistent. Tonnage percentiles are more directly comparable to the bar heights.
- ACWR uses 4-week acute / 16-week chronic EWMA windows (weekly tonnage units) rather than the original 7-day/28-day daily windows. Strength training is typically weekly-granular; the ratio is preserved (≈1:4) while avoiding the need to impute missing days.
- `TrainingLoadChart` does not use `ZonedLine` kind (prompt said "reuse existing kinds"). ZonedLine is single-series; the Training Load chart needs per-exercise multi-series lines, so it composes primitives directly like `StrengthCompositeChart`. Same pattern, just ACWR values instead of σ.
- `MomentumChart` dual-panel does not include an acceleration line (was in spec). Velocity-of-velocity is too noisy on sparse strength training data (sessions 1-2x/week). Showing velocity bars alone is more actionable.
- The prompt mentioned "load quality composite score for Group 4's hero row" — this was not implemented. The composite score (§3.2) depends on ACWR + INOL + tonnage trend signals that require normalization against a baseline, which has its own z-scoring pass. Deferred to Group 4 when the hero row is built.

### Gotchas & surprises

- `ZoneRects` requires a `leftScale` (not `yScale`) parameter name — the prop surface uses `leftScale` / `rightScale`, not generic `yScale`. Check the primitive signature when using it in new charts.
- `ZonedLine` kind does not support multi-series or point-only scatter mode — both require composing primitives directly. The kind is strictly single-line + zones + threshold fill.
- `dayjs().endOf('isoWeek')` returns Sunday when the `isoWeek` plugin is active, consistent with `dayjs().isoWeek()` numbering. This is the correct behavior; no workaround needed.
- Circular dependency would occur if `utils.ts` (imports from `constants.ts`) also defined types that `constants.ts` needs. Resolved by placing `AcwrZone` in `types.ts` (neutral, no imports), keeping zone color helpers in `constants.ts`.
- `oxlint` requires `v === null || v === undefined` rather than `== null` — caught all uses of `acwr[ex]` where the value might be `null` or `undefined` from a `Record<string, number | null>` lookup. Fixed with explicit guards in tooltip rendering.

### Future improvements

- `weeklyTonnageSeries` fills zero-tonnage weeks, which seeds the EWMA with training gaps. A more sophisticated approach would use an absence-adjusted EWMA (exponential decay during gaps), but this complicates the implementation significantly for marginal gain.
- `buildMomentumChartData` calls `velocityAtDate` per session — O(n²) over the workout list. Fine for datasets < 500 sessions; could be vectorized if needed.
- `volumeLandmarks` uses a rolling 90-day window from today, not from the last workout date. This means the landmarks shrink during training breaks. Intent is correct (reflect recent capacity), but worth noting.

---
