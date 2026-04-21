# Group 2 — Visx Migration & Strength Trajectory

## What You're Doing

Replace `charts.tsx` (Recharts) with `visx-charts.tsx`, ship the first section of the new
dashboard ("Strength Trajectory"), and wire the page-level `HoverContext` + cross-chart hover
sync that every subsequent group depends on. Two charts: **1RM Trend** (`ZonedLine`) and
**Strength Composite** (bespoke z-score chart, clone of Fitness Trends). Delete the v1
`AreaMetricChart` and `FrequencyChart`.

After this group, the page loses the old visuals and gains the first two new charts. Sections
2–5 are placeholder until later groups. The history view and workout form are untouched.

---

## Research & Exploration First

1. Read `docs/STRENGTH-ANALYTICS.md` §2.6 (velocity & momentum), §2.10 (personal z-score),
   §4.1–§4.5 (layout and chart contracts).
2. Read **`packages/dashboard/src/pages/garmin-health/index.tsx`** — this is the layout pattern
   you mirror. Copy the `HoverContext.Provider`, filter bar, section titles, `Row/Col` 50/50
   grid, and empty-state guards.
3. Read `packages/dashboard/src/pages/garmin-health/visx-charts.tsx` — pick up the `ChartCard`
   contract (subtitle, extra, tooltip prop), the `ParentSize` wrapper, the legend placement
   pattern.
4. Read **`FitnessTrendChart`** inside `visx-charts.tsx` — this is what you are cloning for
   Strength Composite. Shared-axis z-score plot with three series. Copy the structure, swap the
   inputs, adjust SD floors per analytics §2.10.
5. Read `packages/dashboard/src/charts/kinds/ZonedLine.tsx` — the kind you'll use for 1RM Trend.
6. Read `.claude/rules/visx-charts.md` top-to-bottom. Every rule there is enforced.
7. Grep for `useHoverSync` usage across the garmin-health page — every chart uses it the same way.

---

## What to Implement

### 1. New per-lift color tokens in `src/charts/tokens.ts`

Confirm Group 1 already added `VX.series.benchPress`, `.squat`, `.deadlift`, `.pullUps`. If not,
add them now. Keep the hex values stable across themes (lifts are a metric dimension — same
identity in both modes, like `VX.series.hrv`).

### 2. Utilities (`strength-tracker/utils.ts` or new `analytics.ts`)

Implement the client-side analytics from `STRENGTH-ANALYTICS.md`:

- `velocityPctPerDay(workouts, exerciseId, windowDays = 28)` — linear regression of e1RM over the
  last N days, returning `%/day` (divided by the window-end e1RM for cross-lift comparability).
- `momentumPctPerDay2(workouts, exerciseId, windowDays = 28)` — linear regression of the rolling
  velocity series.
- `strengthDirection(velocityPctPerDay)` — 3-level verdict (`improving | stable | declining`)
  with the thresholds from §2.6.
- `personalZScore(series, floor)` — shared with the Strength Composite. Same math as Fitness
  Trends (`(x − μ) / max(σ, floor)`), 90-day baseline window.
- `weeklyWorkVolume(workouts, exerciseId, weekEndDate)` — sum of `effective_weight × reps` for
  eligible work-typed sets in the 7 days ending at weekEndDate. Needed for tonnage-growth in the
  composite and for Group 3.
- `tonnageGrowthRatio(workouts, exerciseId, date)` — `weeklyVolume(this week) / weeklyVolume(28d MA)`.
  Used as a composite input.
- `sessionInol(workout, body_weight_fn)` — per §2.3, clamped %1RM to [40, 99].

Unit-test with Console.log against the demo data generator if in doubt — there's no test suite,
so hand-verify a couple of values against the ones Garmin Health would produce for a similar
setup.

### 3. New chart file `packages/dashboard/src/pages/strength-tracker/visx-charts.tsx`

Patterned on the Garmin equivalent. Exports:

```ts
export function OneRmTrendChart(props: { workouts: Workout[]; activeExercises: string[] }): JSX.Element
export function StrengthCompositeChart(props: { workouts: Workout[]; exerciseId: string }): JSX.Element
```

#### `OneRmTrendChart` — `ZonedLine<T>`

- Per-lift series using `VX.series.<exercise>`.
- 30-day MA as a dashed overlay (legend shape `splitLine`). Reuse or clone the MA utility from
  v1 `utils.ts`.
- Reference line at best-ever e1RM per active lift (subtle dashed horizontal).
- PR dots: apply the v1 1.5s fade-in UX (see `charts.tsx` `prOpacity` state pattern). Copy it
  into the visx version so the dots still animate in.
- Subtitle: `"Am I getting stronger?"`
- Header extra: the most recent e1RM (primary active lift) + a ▲/►/▼ direction arrow from
  `strengthDirection(velocity)`.
- Tooltip rows: date + e1RM + best-set details ("120 × 6 @ RIR 2 → 143.9 kg") + MA value.
- Legend-hover dim-others (shipped pattern — see how `FitnessTrendChart` does it).

#### `StrengthCompositeChart` — bespoke single-axis (clone of `FitnessTrendChart`)

- Three series, all z-scored on a shared σ axis:
  - Velocity z (7d MA)
  - Tonnage-growth z (7d MA)
  - INOL-per-session z (7d MA)
- Dashed zero line = personal baseline.
- Subtitle: `"Is the gain broad-based?"`
- Header extra: today's σ reading for each series as a compact 3-column chip (like
  `FitnessTrendChart`'s "VO2 · RHR δ · HRV δ" row).
- Tooltip shows raw values + σ readings side by side.
- SD floors from §2.10: velocity 0.05, tonnage_growth 0.02, INOL 0.1.
- Only one lift at a time — if multiple are active in the filter bar, render a selector that
  defaults to the first active lift. Or render one composite per lift in a small grid — mirror
  whatever is simpler and matches Fitness Trends' pattern (which is single-user, one chart).

### 4. Rewire `strength-tracker/index.tsx`

- Wrap the content in `<HoverContext.Provider>` exactly like Garmin Health.
- Replace the content area's chart stack with the Garmin-style `Row gutter={[16, 16]}` + `Col
  xs={24} lg={12}` grid for 50/50 layout.
- For this group, render only **Section 1 (Strength Trajectory)** with the two new charts.
  Scaffold empty `<SectionTitle>` headers for Sections 2, 3, 4 with a placeholder "Coming in
  Group N" card (AntD `Empty` component, a grey inert card, whatever is cheapest — just mark the
  space).
- Filter bar stays — active-lift chips, date presets, reset, demo toggle, view (charts/history).
- Sidebar (WorkoutForm + RecentRecords) stays unchanged.

### 5. Delete v1 chart code

- Delete `charts.tsx` (or rename to `charts.old.tsx` and exclude from the build — cleaner to
  delete outright since git history preserves it).
- Delete the v1 `MainChart`, `AreaMetricChart`, `FrequencyChart` imports from `index.tsx`.
- Delete the corresponding `st-left-metric`, `st-right-metric`, `st-area-metric`, `st-show-ma`
  keys from `ST_KEYS` in `use-local-state.ts` (stale prefs).

### 6. Update `stats.tsx` minimally

Do NOT touch the existing `SummaryStats` cards yet — they'll be replaced by the hero row in
Group 4. For this group, just make sure they still render against the new `exercise_id` field.

---

## Validation

```bash
bun install && bun run lint
cd packages/api && bun tsc --noEmit
cd packages/dashboard && bun tsc --noEmit && bun run build
bun run format:check  # if the script exists
```

Manual — start the dev server, open `https://dashboard.test/strength-tracker`, and confirm:

- 1RM Trend renders with all 4 lifts active, per-lift colors correct.
- Hovering anywhere on 1RM Trend draws a ghost crosshair on Strength Composite, and vice versa.
- Toggling dark/light theme updates chart colors without reload.
- Legend-hover on 1RM Trend dims the non-hovered lifts.
- PR dots fade in after ~1.5s (v1 parity).
- Sections 2–4 show placeholder titles/empty cards.
- No console errors. No `@visx/tooltip` import in any chart file.
- `grep -r 'localStorage.getItem..theme' packages/dashboard/src/pages/strength-tracker/` returns
  nothing.
- `grep -rE '#[0-9a-fA-F]{6}' packages/dashboard/src/pages/strength-tracker/visx-charts.tsx`
  returns nothing (no raw hex).

---

## Commit

```bash
git add packages/dashboard packages/api   # API only if you added tokens / exercises changes
git -c commit.gpgsign=false commit --no-verify -m "refactor(dashboard): visx Strength Trajectory section; delete v1 Recharts"
```

Fallback per shared-context.md if it fails.

---

## Done

Append notes, then:

```
RALPH_TASK_COMPLETE: Group 2
```
