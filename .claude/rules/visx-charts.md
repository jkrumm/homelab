---
paths:
  - packages/dashboard/**
---

# Visx Charts — Dashboard Implementation

Project-specific primitives, tokens, and kinds for the homelab dashboard. For the general philosophy and cross-project conventions, see: `~/SourceRoot/claude-local/rules/visx-charts.md`.

## Where things live

```
packages/dashboard/src/charts/
  tokens.ts              # VX palette + VX.series (per-metric colors) + margins/sizing
  theme.tsx              # useVxTheme() — theme-resolved neutrals, reads ThemeContext
  hover-context.ts       # HoverContext for shared-cursor sync across charts
  primitives/
    ChartCard.tsx        # Card + info-tooltip title + extra slot (MANDATORY wrapper)
    ChartLegend.tsx      # Legend with line | bar | split | splitLine shapes
    ChartTooltip.tsx     # ChartTooltip + TooltipHeader / TooltipRow / TooltipBody + useTooltipStyles
    Axes.tsx             # AxisLeftNumeric, AxisBottomDate (smart ticks + theme baked in)
    HoverOverlay.tsx     # Transparent <rect> for onMouseMove/Leave
  hooks/
    useChartTooltip.ts   # Tooltip state + direct-DOM positioning to avoid re-renders
    useHoverSync.ts      # Closest-point snap + HoverContext broadcast + tooltip (REQUIRED for non-sparkline charts)
  kinds/
    ZonedLine.tsx        # Threshold-line with zones/thresholds/refLines (ACWR, Recovery, …)
  utils/
    format.ts            # fmtAxisDate (DD.MM), fmtTooltipDate (Mon Apr 21 2026)
    ticks.ts             # smartTicks — evenly-spaced from width
  index.ts               # single barrel — import { ChartCard, VX, ZonedLine, … } from '../../charts'
```

Theme toggle state lives at `src/providers/theme.tsx` (`ThemeProvider` + `useTheme`).

## Building a page chart (using an existing kind)

1. Import from `../../charts` (the barrel). Don't deep-import.
2. Wrap in `<ChartCard title={...} tooltip={METRIC_TOOLTIPS.xxx} extra={...}>`.
3. Put the chart body inside `<ParentSize debounceTime={100}>{({ width }) => (...)}</ParentSize>`.
4. Instantiate the kind (e.g. `<ZonedLine .../>`) or compose primitives for bespoke shapes (`DivergenceChartInner` is the reference).
5. Append `<ChartLegend items={[...]} highlighted={null} onHighlight={() => {}} />` outside the ParentSize.

## Kinds currently available

- **`ZonedLine<T>`** — single line with zone backgrounds, threshold fills, reference lines, tooltip. Used by ACWR, Recovery.

When the second instance of a new pattern appears (stacked area, bar, stacked bar, combo bar+line, scatter…), extract it into `charts/kinds/`. **Do not speculate on shapes you haven't built yet.**

---

## Adding a new chart kind — recipe

Follow this exactly. ZonedLine is the canonical example; read it first (`src/charts/kinds/ZonedLine.tsx`).

### Checklist

- [ ] File at `src/charts/kinds/<KindName>.tsx`. Export the component + its `<KindName>Props<T>` type.
- [ ] Component is generic over the data-point type `T` (never `any`).
- [ ] Props include the **standard fields** (see interface below).
- [ ] `useHoverSync<T>` for mouse snap + cross-chart crosshair. **Do not reimplement the closest-point loop inline.**
- [ ] `useVxTheme()` for theme-reactive neutrals (`line`, `axis`, `tooltipBg`, …).
- [ ] `VX.*` tokens for semantic colors. **No raw hex in the file.**
- [ ] `<AxisLeftNumeric>` / `<AxisBottomDate>` — not raw `<AxisLeft>` / `<AxisBottom>`.
- [ ] `<HoverOverlay>` for the mouse-capture rect.
- [ ] `<ChartTooltip>` + `<TooltipHeader>` / `<TooltipRow>` / `<TooltipBody>` — **never** `@visx/tooltip`.
- [ ] xScale domain built from **all `data`** (not filtered), so the x-axis preserves calendar continuity through nulls.
- [ ] Filtered `valid` array for the series/tooltip (drop nulls).
- [ ] Export from `src/charts/index.ts` barrel.
- [ ] Migrate the **two existing instances** to it in the same commit. (If there's only one instance, you're extracting too early — don't.)

### Standard props interface

Every kind should have these baseline props. Add kind-specific props on top.

```ts
export type <KindName>Props<T> = {
  data: T[]
  width: number
  height: number
  chartId: string                      // unique; drives HoverContext sync
  getX: (d: T) => string               // category extractor (usually date)
  // Kind-specific accessor(s) — e.g. getY, getValue, series
  // Kind-specific visual config — zones, stacks, bars, etc.

  // --- Tooltip (shared pattern) ---
  tooltipLabel?: (d: T) => { text: string; color: string } | null
  seriesLabel: string                  // row label in tooltip body
  formatValue: (v: number) => string
  renderExtraTooltipRows?: (d: T) => ReactNode

  // --- Axis (shared pattern) ---
  numTicksX?: number
  numTicksY?: number
}
```

### Skeleton

```tsx
import { Group } from '@visx/group'
import { scaleLinear, scalePoint } from '@visx/scale'
import { useMemo } from 'react'
import { AxisBottomDate, AxisLeftNumeric } from '../primitives/Axes'
import { ChartTooltip, TooltipBody, TooltipHeader, TooltipRow, useTooltipStyles } from '../primitives/ChartTooltip'
import { HoverOverlay } from '../primitives/HoverOverlay'
import { useHoverSync } from '../hooks/useHoverSync'
import { useVxTheme } from '../theme'
import { VX } from '../tokens'
import { smartTicks } from '../utils/ticks'

export function <KindName><T>(props: <KindName>Props<T>) {
  const { data, width, height, chartId, getX, /* … */ } = props
  const { line } = useVxTheme()
  const MARGIN = VX.margin
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map(getX), range: [0, xMax], padding: 0.3 }),
    [data, xMax, getX],
  )
  const yScale = useMemo(() => /* kind-specific */, [/* deps */])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<T>({ data, chartId, getX, xScale, marginLeft: MARGIN.left })

  const tickValues = useMemo(() => smartTicks(data.map(getX), xMax), [data, xMax, getX])

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {/* kind-specific rendering — zones, bars, areas, lines, dots */}
          {/* crosshair + hover marker(s) driven by syncedPoint */}
          <AxisLeftNumeric scale={yScale} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {/* TooltipHeader + TooltipBody with TooltipRow(s) */}
      </ChartTooltip>
    </div>
  )
}
```

### Kind-specific notes

**StackedArea** — `series: { key: string; label: string; color: string }[]`; use visx `Area` + `stack` from d3-shape. Hover snaps on x only; tooltip shows all series rows.

**Bar / StackedBar** — bars are `<rect>`s inside `data.map(...)`. Width: `Math.max(xMax / data.length * 0.6, 2)` (reference: Divergence histogram). Hover crosshair is a vertical `<line>` at `xScale(syncedPoint)`; the dot is the bar itself highlighted.

**Combo bar+line** — compose primitives directly, don't try to unify. Two render passes over the same x/yScales. Extract only if you build a second combo and they share the same legend/tooltip shape.

**Dual-panel** (MACD-style) — stay bespoke in the page file (see `DivergenceChartInner`). Two `Group`s with different `top`. Single `useHoverSync` drives both panels.

### Anti-patterns

- ❌ A single `<Chart type="line" | "bar" | "area" />` god-component. This is the Recharts trap.
- ❌ Importing from `@visx/tooltip` directly. Banned by oxlint.
- ❌ Hardcoded hex colors. Use `VX.series.<metric>` or `VX.goodSolid` etc.
- ❌ Reading `localStorage.getItem('theme')`. Use `useTheme()` / `useVxTheme()`.
- ❌ Reimplementing the closest-point loop. Use `useHoverSync`.
- ❌ Filtering `data` before building `xScale` — compresses the axis across nulls.
- ❌ Extracting a kind after only one instance. Wait for the second (Rule of Three-ish).

---

## Hover sync contract

Every non-sparkline chart wires into `HoverContext`:

- **Write:** via `useHoverSync`, which calls `setHover(date, chartId)` on move and `setHover(null, null)` on leave.
- **Read:** `useHoverSync` returns `syncedPoint` (the matched data point for the currently-hovered date, from any chart) and `isDirectHover` (whether THIS chart's the source).
- **Render:** when `syncedPoint && !isDirectHover`, draw a ghost crosshair + dot. When `isDirectHover`, also show the tooltip.
- The page must provide `<HoverContext.Provider>` — see `pages/garmin-health/index.tsx`. Without it, `useHoverSync` warns once in dev.

## Guardrails active here

- oxlint `no-restricted-imports` bans `@visx/tooltip` inside:
  - `src/charts/**`
  - `src/pages/**/visx-charts.tsx`
  - `src/pages/**/charts.tsx`

  Sparklines under `src/charts/sparklines/**` inherit the rule (primitives still apply; only the Legend/Tooltip contract is relaxed socially).

- Raw hex literals in chart files are a code-review signal, not a lint error (oxlint doesn't support `no-restricted-syntax` with selectors).

## Common edits

**New per-metric color** → `VX.series.<metric>` in `tokens.ts`.
**New semantic color** → add to `VX` in `tokens.ts` + mention in legend.
**New chart kind** → follow the recipe above.
**Bespoke chart** → compose primitives in the page's `visx-charts.tsx`.

## Basalt-ui extraction

Not yet — extract once a second app needs these primitives. All `src/charts/` files are designed to move cleanly: no imports from `src/pages/`, tokens are self-contained, only outward dependency is `providers/theme` (which would move together).
