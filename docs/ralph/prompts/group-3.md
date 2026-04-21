# Group 3 — Load Quality & Efficiency

## What You're Doing

Ship the two biggest evidence sections: **Load Quality** (Weekly Volume + Training Load ACWR) and
**Efficiency & Momentum** (INOL per Session + Momentum dual-panel). These are the charts the user
will live in. Also compute and wire the `Load Quality` composite score so Group 4 can drop it
into the hero row.

Four charts this group. Three reuse existing kinds (`Bars`, `ZonedLine`), one is a bespoke
dual-panel modelled on `DivergenceChartInner` from Garmin Health.

---

## Research & Exploration First

1. Read `docs/STRENGTH-ANALYTICS.md` §2.5 (time-series), §2.7 (ACWR), §2.9 (MEV/MAV/MRV),
   §2.3 (INOL), §2.6 (momentum), §3.2 (Load Quality composite), §4.5 (chart-specific
   treatments for these four charts).
2. Read `packages/dashboard/src/pages/garmin-health/visx-charts.tsx`:
   - `ActivityBarChart` — stacked bars + dual axis + 30d trend line. Template for Weekly Volume.
   - `ACWRThresholdChart` — zone bands, threshold fills, per-series lines. Template for Training
     Load.
   - `DivergenceThresholdChart` (`DivergenceChartInner`) — bespoke dual-panel with one
     `useHoverSync` driving both. Template for Momentum.
3. Read `packages/dashboard/src/charts/kinds/Bars.tsx` — the full prop surface. Especially:
   `positiveBars`, `barLayout: 'grouped'`, `lines`, `zones`, `refLines`, `leftAxis`/`rightAxis`,
   `renderExtraTooltipRows`.
4. Read `packages/dashboard/src/charts/kinds/ZonedLine.tsx` — the full prop surface.
5. Re-read `docs/CHARTS-VISX-MIGRATION.md` "Current Primitives & Kinds" — what `Bars` and
   `ZonedLine` can already do. You should not need to extend either kind this group.

---

## What to Implement

### 1. Analytics additions (`utils.ts` / `analytics.ts`)

Extend the utilities from Group 2 with:

- `ewmaAcute(series, N = 7)` + `ewmaChronic(series, N = 28)` — same λ formula as Garmin Health
  (`2 / (N + 1)`, seeded with `mean(first min(N, available))`). `series` here is the weekly
  tonnage per exercise — see next bullet.
- `weeklyTonnageSeries(workouts, exerciseId, startDate, endDate)` — array of `{ weekEndDate,
  tonnage }`. Use ISO weeks. Sum `effective_weight × reps` over eligible work sets only (not
  warmups).
- `acwr(series, t)` — `ewma_acute(t) / ewma_chronic(t)` with zone classification (< 0.8
  under-loaded, 0.8–1.3 optimal, 1.3–1.5 caution, > 1.5 danger).
- `acwrDivergence(series, t)` — `ewma_acute − ewma_chronic`. Returns signed value.
- `volumeLandmarks(workouts, exerciseId, window = 90)` — returns `{ mev, mav, mrv }` as p25/p50/p90
  of the rolling weekly eligible-work-set count. Floor `mrv` at 3.
- `loadQualityComposite(workouts, exerciseIds, today)` — per §3.2:
  ```
  load_quality = 0.4 × inol_zone_score + 0.4 × acwr_zone_score + 0.2 × volume_landmark_score
  ```
  Each component: 100 inside the optimal zone, linearly decaying by distance out to a defined
  max. Aggregate across active lifts by simple average (document the choice in a comment).

### 2. `WeeklyVolumeChart` — reuse `Bars`

- Stacked bars: warmup (lightest) → work (main) → drop (darker) → amrap (accent). Use
  `VX.goodSoft` for warmup, the lift's series color for work, a darkened variant for drop, and
  `VX.warnSolid` or a designated accent for amrap. Define whatever new tokens you need in
  `tokens.ts` and reference them; don't inline anything.
- Grouped layout when multiple lifts are active (`barLayout: 'grouped'` with per-lift groups).
  Single-lift: stacked layout.
- MEV/MAV/MRV as three horizontal `refLines` (dashed). Use `VX.warnRef` for MEV, `VX.goodRef` for
  MAV, `VX.badRef` for MRV — so high zone = red hint.
- 4-week MA of weekly tonnage as a `lines: [{ axisSide: 'left', dashed: true, strokeWidth: 2 }]`
  overlay.
- Subtitle: `"Am I progressively overloading?"`
- Header extra: current-week tonnage in kg + a small chip indicating which band it sits in
  (below-MEV / MEV-MAV / MAV-MRV / above-MRV).

### 3. `TrainingLoadChart` — reuse `ZonedLine`

- Per-lift ACWR series with `VX.series.<exercise>`.
- Zones: 0–0.8 under-loaded, 0.8–1.3 optimal (green band), 1.3–1.5 caution, >1.5 danger.
- Threshold fills: green above 0.8, red above 1.3 (matches Garmin's ACWR chart pattern).
- Reference lines at 0.8 / 1.3 / 1.5 (dashed).
- Legend-hover dim-others (shipped pattern).
- Subtitle: `"Am I overloading?"`
- Header extra: today's ACWR (primary active lift) + zone label ("Optimal" / "Caution" / …).

### 4. `InolChart` — reuse `ZonedLine` (dots instead of line)

- Per-session dots — use the `ZonedLine` `renderPoints` / `showLine: false` escape hatch if it
  exists. If `ZonedLine` does not support point-only rendering, add a new kind or extend
  `ZonedLine` with a `mode: 'line' | 'points'` prop. Extending is preferred if the second use
  case appears later; otherwise create `ScatterDots<T>` under `kinds/` only if two call sites
  need it. For a single call site, compose primitives directly in `visx-charts.tsx` (read
  `DivergenceChartInner` for the pattern).
- Optimal-zone band at 0.6 – 1.0 (green).
- 10-session moving-average line overlay.
- Dot color per zone (red < 0.4 or > 1.5, yellow 0.4–0.6 or 1.0–1.5, green 0.6–1.0).
- Subtitle: `"Am I loading smart?"`
- Header extra: last session's INOL + zone verdict.

### 5. `MomentumChart` — bespoke dual-panel

Model exactly on `DivergenceChartInner`. Two `Group`s in one SVG:

**Top panel (60% of height):**
- e1RM line for the selected lift (primary color).
- 4-week projection as a dashed line extrapolating from the current velocity slope `f'(t)`.
  Length: 4 weeks forward from today.
- Same x-scale as bottom panel.

**Bottom panel (40% of height):**
- Stacked histogram: `f'(t)` as primary bars, `f''(t)` as secondary narrower bars behind or
  grouped.
- Color by sign: positive green (`VX.goodSolid`), negative red (`VX.badSolid`).
- Zero reference line.

Single `useHoverSync` drives both panels.

- Subtitle: `"Where am I heading next?"`
- Header extra: `f'(t)` in `%/day` + a direction arrow + a sub-text for `f''(t)` sign
  ("accelerating" / "linear" / "decelerating").
- Selector for active lift — same pattern as Strength Composite (single lift at a time).

### 6. Page layout updates (`index.tsx`)

Section 2 now renders Weekly Volume + Training Load in a 50/50 `Row`. Section 3 renders INOL +
Momentum in a 50/50 `Row`. Keep the Group 2 Strength Trajectory section above, and keep the
placeholder for Section 4 (Balance — coming in Group 4).

---

## Validation

```bash
bun install && bun run lint
cd packages/api && bun tsc --noEmit
cd packages/dashboard && bun tsc --noEmit && bun run build
bun run format:check  # if script exists
```

Manual dev-server checks:
- All 4 new charts render.
- Hover on Weekly Volume draws a ghost crosshair on all 5 other charts on the page (1RM, Strength
  Composite, Training Load, INOL, Momentum). Same in every direction.
- ACWR zone bands are visible and readable at both theme settings.
- MEV/MAV/MRV ref lines show on Weekly Volume.
- Momentum's projection dashed line extends 4 weeks into the future (past the last data point).
- No console errors.
- No raw hex, no `@visx/tooltip`, no `localStorage.getItem('theme')`.

---

## Commit

```bash
git add packages/dashboard
git -c commit.gpgsign=false commit --no-verify -m "feat(dashboard): Weekly Volume, Training Load, INOL, Momentum charts"
```

Fallback per shared-context.md if it fails.

---

## Done

Append notes (especially on INOL points-rendering decision — did you extend ZonedLine, add a new
kind, or compose primitives? Document why), then:

```
RALPH_TASK_COMPLETE: Group 3
```
