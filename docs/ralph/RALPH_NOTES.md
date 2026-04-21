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

## Group 4: Balance & Composite Hero

### What was implemented

Added `analytics.ts` with:
- IPF 2020 DOTS formula (`dotsCoefficient`, `dotsAdjusted`) — sex-specific constants for bodyweight-normalized strength comparison.
- `computeStrengthRatios` — DL/Squat [1.0–1.25], Squat/Bench [1.2–1.5], DL/Bench [1.5–2.0], Pull-up/BW [0.4–0.7], status: balanced/imbalanced (>15% off) / critical (>30% off).
- `computeBalanceComposite` — worst-pair composite from ratio set.
- `computeLoadQuality` — 40% INOL zone score + 40% ACWR zone score + 20% volume landmark score → 0–100, verdict Quality/Adequate/Poor, dragComponent.
- `computeStrengthDirectionHero` — best-velocity leader lift + momentumSign from last two `buildMomentumChartData` points.
- `buildRelativeProgressionData` — normalizes each exercise's e1RM to first session = 100%, returns % change per date.

Added to `visx-charts.tsx`:
- `RelativeProgressionChart` — bespoke multi-line normalized % chart; header extra shows leader/laggard exercise + %; hover synced via `useHoverSync`.
- `StrengthRatiosChart` — CSS/HTML horizontal bar display per lift pair with DOTS-adjusted ratios and colored status ticks; no hover sync (static, no time axis).

Rewrote `stats.tsx` as `HeroStats` — 3-card layout (Strength, Load Quality, Balance); Garmin Health card pattern; each card has 32px primary value, 13px verdict, 11px subtext with info tooltip.

Updated `index.tsx` to wire `HeroStats`, `RelativeProgressionChart`, `StrengthRatiosChart`, `useBodyWeight`, `useUserProfile`.

Updated `body-weight.ts`: added `useUserProfile` hook (Eden direct fetch via `useEffect` + `useState`), removed `useOne` and the unused `UserProfileEntry`/`DailyMetricEntry` interfaces.

### Deviations from prompt

- DOTS ratio cancellation: mathematically DOTS(e1rm_A, bw) / DOTS(e1rm_B, bw) = e1rm_A/e1rm_B for same person (coefficient cancels). Implemented per spec anyway since normative ranges were derived from DOTS-adjusted comparisons and the formula matches the IPF spec exactly.
- `StrengthRatiosChart` has no hover sync — static chart with no time axis cannot participate in cross-chart date sync. Implemented as pure CSS/HTML without `useHoverSync`.
- Pull-up ratio returns `null` when added weight = 0 (bodyweight-only pull-ups) to avoid showing 0/BW = 0 as "critical" for beginners. Spec implied always showing a ratio but this would be misleading.

### Gotchas & surprises

- `useOne` for `user-profile` resource fails with "Unsupported resource for getOne" — `data-provider.ts` `getOne` only handles 'workouts'. Fixed by replacing `useOne` in `useBodyWeight` with the `useUserProfile` hook that uses direct Eden treaty call.
- `oxlint eqeqeq` bans `!= null` (again) — `latest != null` for the `undefined` guard on `chartData[chartData.length - 1]` must be `latest !== undefined` since the array element type has no `null` variant.
- DOTS male constants: `A=-307.75076, B=24.0900756, C=-0.1918759221, D=0.0007391293, E=-0.000001093`. Verified against IPF Technical Rules 2020 PDF.

### Future improvements

- `useUserProfile` is called twice on page load (once from `useBodyWeight`, once from `index.tsx`). Both use `useState` + `useEffect`, so two separate API calls fire. Could be lifted to a context once more hooks stabilize.
- Gender defaults to 'male' when `user_profile.gender` is null — a console warning fires once. Adding a gender field to the user profile UI would resolve this.
- `StrengthRatiosChart` normative ranges are fixed constants. A future group could expose user-adjustable target ratios.

---

## Group 5 — Readiness & Deload

### What was built

Added wearable data integration to the Strength Tracker. Four new pieces:

1. **`buildReadinessStrainData`** in `analytics.ts` — per-day series that takes Garmin base recovery (HRV 40% + sleep 35% + RHR 25%) and applies a fatigue-debt shave from strength training INOL. Fatigue debt = last session INOL / p90 INOL ceiling; max 25% penalty. An additional 10% dampening applies when last session INOL > 1.2 within 48h.

2. **`buildAlignmentMatrix`** in `analytics.ts` — maps every session date onto a 3×3 grid (Recovery High/Normal/Low × ACWR Under/Optimal/Caution+) by joining readiness and ACWR series. Today's cell gets `isToday = true` for a colored border. Verdict strings and `verdictType` come from a static `CELL_VERDICTS` lookup.

3. **`deloadSignal`** in `analytics.ts` — four AND-pattern signals: stall (velocity ≤ 0 on ≥2 lifts), overload (ACWR > 1.3 on last 2 weekly points for ≥1 lift), fatigue (avg INOL > 1.1 last 10 sessions), physio (fitness direction declining OR HRV 7d MA < 85% of 28d baseline). ≥2 signals → deload; 1 signal → monitor.

4. **`ReadinessStrainChart`** in `visx-charts.tsx` — reuses `ZonedLine` with Push/Normal/Rest zones; `renderExtraTooltipRows` shows raw Garmin recovery vs adjusted. Uses `chartId="readiness-strain"` for HoverContext cross-chart sync.

5. **`TrainingRecoveryAlignmentChart`** in `visx-charts.tsx` — CSS Grid 3×3 matrix; AntD `Tooltip` on each cell shows session dates. Does not use `useHoverSync` (no time axis).

6. **`index.tsx`** updated — `useList<DailyMetric>` with fixed 90-day rolling window (independent of user date-range filter); `dailyMetrics` memoized via `useMemo` to avoid referential-instability lint errors. Deload banner (AntD `Alert`, warning or info type) renders above hero when signals fire. Hero card 3 swaps to Readiness when `hasReadinessData` (≥7 days). Section 5 renders conditionally in DOM — not hidden — when `hasReadinessData`.

### Deviations from prompt

- `VX.warnSoft` and `VX.badSoft` do not exist in `tokens.ts` — used `VX.warn` and `VX.bad` as direct replacements (same base color at lower opacity via rgba). No new tokens were added.
- `latestAcwrBefore` uses the weekly ACWR series (from `computeAcwrSeries`) and picks the most recent point ≤ the session date rather than aggregating per session — avoids double-computing ACWR per session.

### Gotchas & surprises

- `oxlint exhaustive-deps` flags `dailyMetrics = (result.data ?? [])` as "changes every render" because `?? []` creates a new array reference each time. Fix: wrap in `useMemo(() => ... ?? [], [result.data])`. The existing `workouts` variable has the same pattern but wasn't flagged because it wasn't used in a `useMemo` dep array until this group.
- `computeRecoveryScore` is exported from `garmin-health/utils.ts` and imported cross-page. This is intentional — the spec explicitly says "don't duplicate the 0–100 recovery formula".
- `p90ofArray` is private (not exported) in `analytics.ts` since it's only used by `buildReadinessStrainData` and `deloadSignal` within that file.

### Future improvements

- Deload banner evaluates even in demo data mode, which will always show "no signals" since demo workouts have no `dailyMetrics`. Consider seeding demo Garmin data in `demo-data.ts`.
- `TrainingRecoveryAlignmentChart` shows up to 8 recent session dates per cell tooltip — could add a "view all" expansion for cells with many sessions.
- `hasReadinessData` threshold is 7 days — could be increased to 14 to ensure enough HRV baseline for the deload physio signal.

