# Visx Migration — Garmin Health Dashboard

> Migrate the 5 remaining Recharts charts on the Garmin Health page to visx, extracting one new
> reusable kind (`Bars`) along the way. Use the visx freedom to genuinely improve the most
> important chart on the page (Sleep) instead of a 1:1 rewrite.
>
> Scope: `packages/dashboard/src/pages/garmin-health/` only. Strength-Tracker migration is a
> follow-up effort once kinds settle (referenced design lives in `docs/STRENGTH-ANALYTICS.md`).

---

## Mission

After this migration:

1. `packages/dashboard/src/pages/garmin-health/charts.tsx` no longer exists.
2. `recharts` is removed from `packages/dashboard/package.json`.
3. The page renders 8 visx charts: ACWR + Recovery + Divergence (already done), plus Fitness,
   Sleep, BodyBattery, Stress, Activity (this effort).
4. A new `Bars` kind sits next to `ZonedLine` in `src/charts/kinds/`, used by Sleep and Activity
   on day one and by Strength-Tracker's Volume + Momentum presets in the next round.
5. `AxisRightNumeric` primitive exists, fully theme-aware.
6. Sleep Breakdown is the best chart on the page — diverging stage stack, target-zone band,
   sleep-score line, full hover sync.
7. `.claude/rules/visx-charts.md` documents the `Bars` kind + dual-axis convention.

---

## Inventory — what exists, what changes

### Currently on Recharts (this migration)

| # | Chart | File | Pattern | Migration target |
|-|-|-|-|-|
| 1 | `FitnessChart` | `charts.tsx:78` | dual-axis: 2 lines + dot scatter | bespoke in `visx-charts.tsx` |
| 2 | `SleepChart` | `charts.tsx:197` | dual-axis: stacked bar + line | `Bars` kind (DIVERGING + improved) |
| 3 | `BodyBatteryChart` | `charts.tsx:264` | range band area | bespoke in `visx-charts.tsx` |
| 4 | `StressChart` | `charts.tsx:319` | area + line + ref lines | bespoke in `visx-charts.tsx` |
| 5 | `ActivityChart` | `charts.tsx:371` | dual-axis: bar + line + ref | `Bars` kind (IMPROVED) |

### Already on visx (reference, do not touch)

| Chart | File | Kind / pattern |
|-|-|-|
| `ACWRThresholdChart` | `visx-charts.tsx:40` | `ZonedLine` |
| `DivergenceThresholdChart` | `visx-charts.tsx:311` | bespoke dual-panel |
| `RecoveryThresholdChart` | `visx-charts.tsx:352` | `ZonedLine` |

### Future strength-tracker charts (informs `Bars` kind design)

From `docs/STRENGTH-ANALYTICS.md` §4.2:

| Future preset | Pattern | Will use |
|-|-|-|
| Volume preset | weekly stacked bar (warmup/work/drop) + line (set count) | `Bars` |
| Strength preset | line + line + momentum bar | bespoke |
| Efficiency preset | line + line + shaded optimal zone | `ZonedLine` (dual axis) |
| Momentum preset | line top + stacked area f'/f'' bottom | bespoke (dual-panel like Divergence) |
| Recovery preset | area zones + dot markers + line | likely bespoke |

`Bars` covers Volume preset on day one and likely the Momentum bottom panel (diverging
stacked bars). Three+ confirmed instances justify the extraction.

---

## Architecture decisions

### A1 — One new kind: `Bars`

Plural, to avoid shadowing visx's own `<Bar>` shape primitive. Required prop is
`positiveBars`; everything else (negative stacks, line overlay, zones, refLines) is
optional. A single bar series with no line is also a valid `Bars` use — this is "the
kind that handles bars on a categorical x-axis", not "a bar+line god component".

File: `src/charts/kinds/Bars.tsx`. Props interface in §B below.

### A2 — One new primitive: `AxisRightNumeric`

Mirrors `AxisLeftNumeric` in `src/charts/primitives/Axes.tsx`. Wraps `<AxisRight>` from
`@visx/axis` with the same theme tokens, font size, tick stroke. Required for any
dual-axis chart (Sleep, Activity, Fitness, BodyBattery score).

### A3 — No `TargetBand` primitive

A target band is a horizontal value-range rect. `ZonedLine` already handles this with
a `zones: { from, to, fill }[]` prop. `Bars` uses the **identical** prop shape. If a
third bespoke chart genuinely wants the same overlay later, extract then.

### A4 — `Bars` mirrors `ZonedLine` conventions

Same standard prop interface (`data`, `width`, `height`, `chartId`, `getX`, `seriesLabel`,
`formatValue`, `tooltipLabel`, `renderExtraTooltipRows`, `numTicksY`, `numTicksX`). Same
hover-sync hook. Same theme tokens. Same axis primitives. The only delta is the rendered
shape and the dual-axis support.

### A5 — Dual axis via two scales, not a single scale with overrides

`Bars` accepts an optional `rightAxis: { domain, formatValue }` block. When present,
the kind builds a second `scaleLinear` for the right side and passes it to the optional
line overlay. The kind owns both scales internally; consumers don't compose scales themselves.

### A6 — Stay bespoke for Fitness / BodyBattery / Stress

Single-instance shapes. Building speculative kinds for one-off visuals is the
Recharts trap. Composing primitives directly is fine and 60-80 lines per chart.

---

## B. `Bars` kind — prop interface

```ts
export type BarsBar = {
  /** Field key on each data point — `getValue(d, key)` extracts the number (null = skip). */
  key: string
  /** Tooltip / legend label. */
  label: string
  /** Fill color (use VX.series.* — never raw hex). */
  color: string
}

export type BarsLine = {
  key: string
  label: string
  color: string
  /** Which y-axis the line is plotted against. Defaults to 'left'. */
  axisSide?: 'left' | 'right'
  /** Stroke width. Defaults to VX.lineWidth. */
  strokeWidth?: number
  /** Dashed line (e.g. moving averages). */
  dashed?: boolean
}

export type BarsZone = {
  from: number
  to: number
  fill: string
  /** Which y-axis the zone is anchored to. Defaults to 'left'. */
  axisSide?: 'left' | 'right'
}

export type BarsRefLine = {
  value: number
  color: string
  dashed?: boolean
  axisSide?: 'left' | 'right'
}

export type BarsAxisConfig = {
  /** Fixed [min, max] or 'auto' (computed from bars + line). */
  domain: [number, number] | 'auto'
  /** Auto-domain padding multiplier away from zero. Default 1.1. */
  autoPad?: number
  /** Auto-domain min ceiling — never above this. Default 0. */
  autoMinCeil?: number
  /** Auto-domain max floor — never below this. */
  autoMaxFloor?: number
  /** Tick label format (e.g. (v) => `${v}h`). */
  formatTick?: (v: number) => string
  /** Number of ticks. Default 5. */
  numTicks?: number
}

export type BarsProps<T> = {
  data: T[]
  width: number
  height: number
  chartId: string
  getX: (d: T) => string
  /** Generic value accessor — given a data point and a bar/line key, returns the value or null. */
  getValue: (d: T, key: string) => number | null

  /** 1+ bar series, stacked when ≥2, plotted above baseline (y >= 0). */
  positiveBars: BarsBar[]
  /** Optional bar series stacked below baseline (rendered as flipped negatives). */
  negativeBars?: BarsBar[]

  /** 0–2 line overlays, each on left or right axis. */
  lines?: BarsLine[]

  /** Horizontal value-range overlays (target zones, optimal bands). */
  zones?: BarsZone[]
  /** Dashed/solid horizontal reference lines. */
  refLines?: BarsRefLine[]

  /** Left axis config (always present — bars live here). */
  leftAxis: BarsAxisConfig
  /** Right axis config — only required when at least one line/zone/refLine uses 'right'. */
  rightAxis?: BarsAxisConfig

  /** Bar width as fraction of slot width. Default 0.6 (matches Divergence histogram). */
  barWidthRatio?: number

  /** Tooltip badge — appears at the right of the tooltip header. */
  tooltipLabel?: (d: T) => { text: string; color: string } | null
  /** Optional extra tooltip rows AFTER the bar+line rows. */
  renderExtraTooltipRows?: (d: T) => ReactNode
  /** X-axis tick count override. */
  numTicksX?: number
}
```

**Implementation notes:**

- Stacking math: positive bars stack from y=0 upward in the order given; negatives stack from y=0
  downward. The stacked total per side is computed per-data-point.
- Auto-domain on the left axis includes the *stacked total* (positive max above 0, negative min
  below 0), not individual bar values.
- The right axis is independent of left bars — its domain only considers right-side lines/zones.
- Bar width: `Math.max(slotWidth * barWidthRatio, 2)`. Slot width = `xScale.step()` for `scalePoint`.
- Hover: `useHoverSync` snaps to nearest x. Crosshair is a vertical line at `xScale(syncedPoint)`.
  Bars under the synced x get a faint highlight (`fillOpacity` boost). Lines get a dot at the
  intersection.
- Tooltip: header date + optional badge. Body lists bars (top-to-bottom = visual top-to-bottom,
  so positive stack reads top-down + negative reads downward). Then lines. Then extras.
  Use `TooltipRow` `shape="bar"` for bars, `"line"` for lines.
- X-scale: `scalePoint<string>({ domain: data.map(getX), padding: 0.3 })` — same as `ZonedLine`.
  Built from the FULL `data` array; per-bar nulls are visual gaps, not domain holes.
- Colors come from `VX.series.*`. Awake-below uses `VX.series.awake` directly (no special token).

---

## C. Sleep Breakdown — the showcase chart

### Visual concept

Diverging stacked bars with target-zone band and sleep-score overlay.

```
  ┌─ Sleep Breakdown ─────────────────────────────[Score 82 ▲]─┐
  │                                                            │
  │ 9h ──────────────────  target zone (7h–9h)  ───────────────│
  │      ▌ ▌▌  ▌▌▌  ▌  ▌▌    REM         (purple — VX.series.rem)
  │ 7h ══▌═▌▌══▌▌▌══▌══▌▌════════════════════════════════════ │
  │      █ ██  ███  █  ██    Light       (light blue)
  │      █ ██  ███  █  ██    Deep        (dark navy)
  │ 0h ──●─●●──●●●──●──●●──── sleepScore line (right axis 0–100)
  │      ▼ ▼   ▼▼   ▼  ▼     Awake       (gray, BELOW baseline)
  │                                                            │
  │      Apr 1 ......................................... Apr 30
  └────────────────────────────────────────────────────────────┘
```

### Why diverging beats stacked

1. **Stage trends become independent.** Tonight's deep sleep doesn't visually shift just because
   light sleep was shorter — its bar starts at 0 every night.
2. **"Restless" reads as a deficit.** Awake time below the baseline is visually distinct from
   sleep stages above it.
3. **Total sleep duration = above-baseline bar height.** Reads against the 7–9h target band at a
   glance without the user adding stages mentally.
4. **Sleep score correlation visible.** A line on the right axis riding above the bars makes the
   "good night × high score" or "fragmented night × low score" pattern pop.

Reference research (Whoop "Restorative Sleep", Oura Trends, RISE sleep debt — see §F).

### Data shape

Reuse the existing `buildSleepChartData` (`utils.ts:96`):

```ts
{
  date: string
  deep: number | null   // hours
  rem: number | null    // hours
  light: number | null  // hours
  awake: number | null  // hours
  sleepScore: number | null
}
```

### `Bars` instantiation

```tsx
<Bars<SleepPoint>
  data={chartData}
  width={width}
  height={280}
  chartId="sleep"
  getX={(d) => d.date}
  getValue={(d, k) => d[k as keyof SleepPoint] as number | null}
  positiveBars={[
    { key: 'deep',  label: 'Deep',  color: VX.series.deep  },
    { key: 'light', label: 'Light', color: VX.series.light },
    { key: 'rem',   label: 'REM',   color: VX.series.rem   },
  ]}
  negativeBars={[
    { key: 'awake', label: 'Awake', color: VX.series.awake },
  ]}
  lines={[
    { key: 'sleepScore', label: 'Sleep Score', color: VX.series.sleepScore, axisSide: 'right' },
  ]}
  zones={[
    { from: 7, to: 9, fill: 'rgba(63, 185, 80, 0.08)', axisSide: 'left' },
  ]}
  leftAxis={{
    domain: 'auto', autoPad: 1.05, autoMaxFloor: 9,
    formatTick: (v) => `${v}h`,
    numTicks: 5,
  }}
  rightAxis={{
    domain: [0, 100],
    numTicks: 4,
  }}
  tooltipLabel={(d) => sleepScoreLabel(d.sleepScore)}
/>
```

`sleepScoreLabel` returns `{ text: 'Excellent' | 'Good' | 'Fair' | 'Poor', color: VX.* }` based
on Garmin's bands (90+/80–89/60–79/<60).

### Hover spec

- Crosshair vertical line at `xScale(date)`.
- Bars under cursor → `fillOpacity` boosted from 0.85 → 1.0.
- Sleep score line → 4px circle dot at `(xScale(date), rightYScale(score))`.
- Tooltip header: date + `Excellent / Good / Fair / Poor` badge.
- Tooltip body rows (in this order, all using `TooltipRow`):
  - Total sleep `(deep+rem+light).toFixed(1)h` — shape="line", color=`VX.series.sleepScore`
  - Deep `Xh Ymin` — shape="bar"
  - Light `Xh Ymin` — shape="bar"
  - REM `Xh Ymin` — shape="bar"
  - Awake `Xh Ymin` — shape="bar"
  - Sleep Score `82` — shape="line"

### Anti-patterns

- ❌ Don't keep awake stacked above light. The diverging design is the upgrade.
- ❌ Don't flatten the diverging back to single-axis if rendering is fiddly — the visual contrast
  is the point.
- ❌ Don't use raw hex for stage colors — they're already in `VX.series.{deep,light,rem,awake}`.

### Acceptance

- [ ] Sleep card renders identically across light/dark theme toggle (live re-render via `useVxTheme`).
- [ ] Hover one chart on the page → Sleep crosshair + tooltip shows ghost crosshair (no tooltip,
      `isDirectHover === false`).
- [ ] Hover Sleep directly → tooltip appears, ghost crosshair appears on ACWR/Recovery/etc.
- [ ] Target zone band 7–9h is visible behind bars, semi-transparent.
- [ ] No `recharts` import remains in the migrated file.
- [ ] Stage colors match the existing chart (don't surprise the user on first render).

---

## D. Activity — improvements over 1:1 migration

### Visual changes

| Today (Recharts) | After |
|-|-|
| Single dashed reference line at 10k steps | **Target zone band** (light green fill from 10k upward) |
| Bars: flat `VX.series.steps` | Bars: same color but `fillOpacity` modulated by intensity-min density (more intensity = more saturated) |
| No trend context | Optional **30-day rolling average line** for steps on left axis (dashed, thin) |
| Intensity minutes line on right axis | Same — keep, but boost `strokeWidth` slightly (1.5 → 2) |

### Data shape

Extend `buildActivityData` (`utils.ts:148`) to include `stepsMA` (30-day rolling average,
matching `movingAverage` in `utils.ts:165`). Don't break existing fields.

### `Bars` instantiation

```tsx
<Bars<ActivityPoint>
  data={chartData}
  width={width}
  height={220}
  chartId="activity"
  getX={(d) => d.date}
  getValue={(d, k) => d[k as keyof ActivityPoint] as number | null}
  positiveBars={[{ key: 'steps', label: 'Steps', color: VX.series.steps }]}
  lines={[
    { key: 'stepsMA', label: '30d avg', color: VX.series.steps, axisSide: 'left', dashed: true, strokeWidth: 1.5 },
    { key: 'intensityMin', label: 'Intensity Min', color: VX.series.intensityMin, axisSide: 'right', strokeWidth: 2 },
  ]}
  zones={[
    { from: 10000, to: leftMax, fill: 'rgba(76, 175, 80, 0.08)', axisSide: 'left' },
  ]}
  refLines={[{ value: 10000, color: 'rgba(76, 175, 80, 0.4)', dashed: true, axisSide: 'left' }]}
  leftAxis={{ domain: 'auto', autoMaxFloor: 12000, numTicks: 5 }}
  rightAxis={{ domain: 'auto', formatTick: (v) => `${v}min` }}
/>
```

Note: `leftMax` is the auto-computed max — the consumer can pass a specific number or use
the `autoMaxFloor` to ensure the band always covers the visible range. Implementation can
post-compute.

### Saturation trick (optional polish)

If implementation cost is low: in the `Bars` kind, accept a `barOpacity?: (d, key) => number`
prop. Activity uses it: `barOpacity: (d) => 0.5 + 0.5 * (d.intensityMin ?? 0) / 60`.
If implementation cost is high: drop the saturation feature, keep the rest. **This is not a
gating requirement.**

### Acceptance

- [ ] Activity card renders with target zone band visible above 10k.
- [ ] Cursor sync works with all other charts on the page.
- [ ] Steps tooltip row shows locale-formatted number (`12,453`).
- [ ] If `barOpacity` was implemented: bars visibly vary in saturation.

---

## E. Phased plan — atomic commits

Each phase produces one commit and can ship independently. `make dash-deploy` between phases.

### Phase 1 — Add `AxisRightNumeric` primitive

**Mission:** add the right-side numeric axis primitive so dual-axis kinds and bespoke charts
have a themed counterpart to `AxisLeftNumeric`.

**Files touched:**
- `src/charts/primitives/Axes.tsx` — add `AxisRightNumeric` next to `AxisLeftNumeric`.
- `src/charts/index.ts` — export `AxisRightNumeric`.

**Impl:** mirror `AxisLeftNumeric`. Use `<AxisRight>` from `@visx/axis`. `tickLabelProps` `dx: 4`
(positive offset, vs `-4` on left).

**Acceptance:**
- [ ] `bun run lint && bun tsc --noEmit` clean.
- [ ] Exported from barrel.
- [ ] No consumer change yet — this just lands the primitive.

**Commit:** `refactor(dashboard): add AxisRightNumeric primitive`

---

### Phase 2 — `Bars` kind + Sleep + Activity migration

**Mission:** build the `Bars` kind and migrate Sleep + Activity to it, with the design
improvements in §C and §D. Replace the recharts implementations entirely.

**Files touched:**
- `src/charts/kinds/Bars.tsx` — new kind, follows `ZonedLine.tsx` structure.
- `src/charts/index.ts` — export `Bars` + types.
- `src/pages/garmin-health/utils.ts` — extend `buildActivityData` with `stepsMA`; add
  `sleepScoreLabel(score)` helper.
- `src/pages/garmin-health/visx-charts.tsx` — add `SleepBreakdownChart` and `ActivityBarChart`.
- `src/pages/garmin-health/charts.tsx` — DELETE `SleepChart` and `ActivityChart` exports.
- `src/pages/garmin-health/index.tsx` — swap imports: `SleepChart` → `SleepBreakdownChart`,
  `ActivityChart` → `ActivityBarChart` from `./visx-charts`.

**Don't touch:**
- Existing `ZonedLine` charts.
- Recharts `FitnessChart` / `BodyBatteryChart` / `StressChart` (later phases).

**Acceptance:**
- [ ] `bun run lint && bun tsc --noEmit` clean.
- [ ] Sleep + Activity render correctly under both themes.
- [ ] Cursor sync verified by hovering ACWR and seeing crosshairs on Sleep/Activity.
- [ ] No `@visx/tooltip` direct import (oxlint catches this).
- [ ] No raw hex literals — all colors from `VX` / `VX.series`.
- [ ] `Bars` kind written generically — Sleep + Activity are configurations, not special cases.
- [ ] Tooltip shows total sleep duration (sum of positives) for Sleep — implemented via
      `renderExtraTooltipRows` or a header field.

**Commit:** `feat(dashboard): Bars kind; migrate Sleep + Activity charts`

---

### Phase 3 — Migrate `FitnessChart` (bespoke)

**Mission:** rebuild the dual-axis line + line + dot-scatter chart in visx, composing primitives
directly. Don't extract a kind — single instance.

**Files touched:**
- `src/pages/garmin-health/visx-charts.tsx` — add `FitnessTrendChart`.
- `src/pages/garmin-health/charts.tsx` — DELETE `FitnessChart`.
- `src/pages/garmin-health/index.tsx` — swap import.

**Visual:** identical to today.
- Left axis: RHR (bpm).
- Right axis: HRV (ms) AND VO2Max share the right axis (today's behavior).
- Lines: `rhrMA` (left), `hrvMA` (right) — both 7d moving average, 2.5px, monotone curve.
- VO2Max: rendered as **circles only** (no line connecting them), 5px radius, white stroke,
  `VX.series.vo2max` fill.
- `headerExtra`: keep the existing summary chip pattern (VO2 / RHR delta / HRV delta).

**Implementation pattern:** follow `DivergenceChartInner` (`visx-charts.tsx:114`) as the
reference for composing primitives directly. Two scales (left, right). One `useHoverSync`
on the longest data series.

**Acceptance:**
- [ ] Theme toggle works.
- [ ] Cursor sync works.
- [ ] VO2Max dots render only on dates where `vo2max !== null`.
- [ ] Tooltip shows RHR/HRV averages + VO2Max if present.
- [ ] Header summary chip unchanged.

**Commit:** `refactor(dashboard): migrate FitnessChart to visx`

---

### Phase 4 — Migrate `BodyBatteryChart` (bespoke)

**Mission:** rebuild the range-band area chart in visx. Use `<Threshold>` to render the
high–low band as a filled area between two lines.

**Files touched:**
- `src/pages/garmin-health/visx-charts.tsx` — add `BodyBatteryRangeChart`.
- `src/pages/garmin-health/charts.tsx` — DELETE `BodyBatteryChart`.
- `src/pages/garmin-health/index.tsx` — swap import.

**Visual:** improve the recharts version.
- Filled band between `low` and `high` using `VX.series.bodyBatteryHigh` at 0.25 opacity.
- Top edge (high): solid 2px line, `VX.series.bodyBatteryHigh`.
- Bottom edge (low): dashed 1.5px line, `VX.series.bodyBatteryLow`.
- Reference line at y=50 (dashed, light red — keep current).
- Y-domain fixed `[0, 100]`.
- Tooltip rows: Morning Low, Daily High, Charged delta if available.

**Implementation:** `<Threshold>` with `y0=low`, `y1=high`, `belowAreaProps={{ fill: VX.series.bodyBatteryHigh, fillOpacity: 0.25 }}`.

**Acceptance:**
- [ ] Band visible across both themes.
- [ ] Cursor sync works.
- [ ] No regression vs today's tooltip content.

**Commit:** `refactor(dashboard): migrate BodyBatteryChart to visx`

---

### Phase 5 — Migrate `StressChart` (bespoke)

**Mission:** rebuild the area + line + ref-lines chart in visx. Single y-axis 0–100.

**Files touched:**
- `src/pages/garmin-health/visx-charts.tsx` — add `StressLevelsChart`.
- `src/pages/garmin-health/charts.tsx` — DELETE `StressChart`.
- `src/pages/garmin-health/index.tsx` — swap import.

**Visual:** identical to today.
- Filled area: `avgStress`, `VX.series.stress`, fillOpacity 0.15, 2px stroke.
- Overlay line: `sleepStress`, `VX.series.sleepStress`, 1.5px, no fill.
- Two ref lines: y=25 (faint green dashed), y=50 (faint warning dashed).
- Tooltip: avg stress + sleep stress.

**Acceptance:**
- [ ] Theme toggle works.
- [ ] Cursor sync works.
- [ ] Ref lines visible.

**Commit:** `refactor(dashboard): migrate StressChart to visx`

---

### Phase 6 — Cleanup + rules update

**Mission:** kill `charts.tsx`, drop `recharts` from `package.json`, document the new kind
and dual-axis convention in `.claude/rules/visx-charts.md` and `packages/dashboard/CLAUDE.md`.

**Files touched:**
- `src/pages/garmin-health/charts.tsx` — DELETE the file. Confirm no remaining imports
  in `index.tsx` or anywhere else.
- `packages/dashboard/package.json` — remove `recharts` from `dependencies`.
- `bun.lockb` — regenerate via `bun install`.
- `.claude/rules/visx-charts.md`:
  - Add `Bars` to "Where things live" tree (next to `ZonedLine.tsx`).
  - Add `Bars` to "Kinds currently available" with one-line summary + which call sites use it.
  - Add a "Dual-axis" subsection explaining `AxisRightNumeric` + the `rightAxis` config block
    convention.
- `packages/dashboard/CLAUDE.md`:
  - Update the "Chart Patterns" section to reflect visx-only state (or delete the recharts
    snippet entirely).
- `.claude/rules/dashboard-patterns.md`:
  - Update the "Chart Tooltip Styling" + "Dual-Axis Recharts" sections — those describe
    recharts and are now stale. Replace with pointers to `visx-charts.md`.

**Acceptance:**
- [ ] `grep -r recharts packages/dashboard/src` returns nothing.
- [ ] `bun run lint && bun tsc --noEmit` clean.
- [ ] Page renders all 8 charts after `make dash-deploy`.
- [ ] Rules doc updated with `Bars` kind documented.

**Commit:** `chore(dashboard): remove recharts; document Bars kind`

---

## F. Sleep design — research references

Pulled from analysis of consumer health products and dataviz literature:

- **Whoop "Restorative Sleep"** — REM + SWS visualised separately from total duration. Inspired
  the diverging-stack idea (separate "good" sleep from "restless").
- **Oura Trends** — stage overlays vs. bedtime; consistency views. Inspired the target-band
  overlay.
- **RISE sleep debt** — 14-day weighted (need − actual). Could become a future second sleep
  card; not in scope today.
- **Tufte small multiples** — considered for stage-by-stage tiny rows. Rejected: 280px is too
  short for 4 rows of bars + a bar chart.
- **Mosaic / Marimekko (variable-width bars)** — rejected: variable x-spacing breaks cursor sync
  with other charts on the page.
- **Apple Health bedtime band** — would require bedtime/wake timestamps not currently captured
  by the garmin-sync sidecar. Future work.

The chosen design (diverging stacked + target band + score line) is the strongest single-card
upgrade given current data and the cursor-sync constraint.

---

## G. Cross-cutting rules to follow in every phase

- Use `useHoverSync` for hover. Never reimplement closest-point loops.
- Use `useVxTheme()` for line/axis/tooltip colors. Never `localStorage.getItem('theme')`.
- Use `VX` / `VX.series` for all colors. No raw hex in chart files.
- Wrap every chart in `<ChartCard>` with `tooltip` from `METRIC_TOOLTIPS`.
- Append `<ChartLegend>` outside `<ParentSize>` for every multi-series chart.
- X-scale built from full `data`, not filtered. Visual gaps for nulls.
- Read `.claude/rules/visx-charts.md` and `~/SourceRoot/claude-local/rules/visx-charts.md`
  before starting any phase.
- One commit per phase. Run `/check` before committing. Don't `--amend` across phases.
- After Phase 6: ship via `make dash-deploy` and verify on `dashboard.jkrumm.com`.
