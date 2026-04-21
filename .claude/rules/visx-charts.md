---
paths:
  - packages/dashboard/**
---

# Visx Charts — Dashboard Implementation

Project-specific primitives, tokens, and kinds for the homelab dashboard. For the general philosophy, conventions, and guardrails that apply across projects, see the global rule: `~/SourceRoot/claude-local/rules/visx-charts.md`.

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
  kinds/
    ZonedLine.tsx        # Threshold-line with zones/thresholds/refLines (ACWR, Recovery, …)
  utils/
    format.ts            # fmtAxisDate (DD.MM), fmtTooltipDate (Mon Apr 21 2026)
    ticks.ts             # smartTicks — evenly-spaced from width
  index.ts               # single barrel — import { ChartCard, VX, ZonedLine, … } from '../../charts'
```

Theme toggle state lives at `src/providers/theme.tsx` (`ThemeProvider` + `useTheme`).

## Building a chart here

1. Import from `../../charts` (the barrel). Don't deep-import.
2. Wrap in `<ChartCard title={...} tooltip={METRIC_TOOLTIPS.xxx} extra={...}>`.
3. Put the chart body inside `<ParentSize debounceTime={100}>{({ width }) => (...)}</ParentSize>`.
4. Inside, either instantiate a kind (`<ZonedLine .../>`) or compose primitives directly for bespoke shapes (see `DivergenceChartInner` in `pages/garmin-health/visx-charts.tsx` for reference).
5. Append `<ChartLegend items={[...]} highlighted={null} onHighlight={() => {}} />` outside the ParentSize.

## Kinds currently available

- **`ZonedLine<T>`** — single line with zone backgrounds, threshold fills, reference lines, tooltip. Used by: ACWR, Recovery. Extend via props before forking.

When the second instance of a new pattern (stacked area, bar-only, stacked bar, combo bar+line…) appears, extract it into `charts/kinds/`. Don't speculate.

## Hover sync

Every non-sparkline chart wires into `HoverContext`:

- Write: `setHover(date, chartId)` on mouse move, `setHover(null, null)` on leave.
- Read: `const { date, source } = useContext(HoverContext)` — show a ghost crosshair + dot on `date` when `source !== chartId`.

`ZonedLine` handles this automatically via its `chartId` prop. Bespoke charts wire it by hand (see Divergence).

## Guardrails active here

- oxlint `no-restricted-imports` bans `@visx/tooltip` inside:
  - `src/charts/**`
  - `src/pages/**/visx-charts.tsx`
  - `src/pages/**/charts.tsx`

  Sparklines under `src/charts/sparklines/**` inherit the rule (the primitives still apply); only the Legend/Tooltip contract is relaxed socially.

- Raw hex literals in chart files are a code-review signal, not a lint error (oxlint doesn't yet support `no-restricted-syntax` with selectors). If you see `'#rrggbb'` in a chart file, add it to `VX` and reference it.

## Common edits

**New per-metric color** → `VX.series.<metric>` in `tokens.ts`.
**New semantic color** (good/bad/warn variant) → add to `VX` in `tokens.ts` + mention in legend.
**New chart kind** (after second instance) → new file in `charts/kinds/`, export from `index.ts`.
**Bespoke chart** → compose primitives in a page's `visx-charts.tsx`, don't drop into `charts/`.

## Basalt-ui extraction

Not yet — extract once a second app needs these primitives. All files under `src/charts/` are designed to move cleanly: no imports from `src/pages/`, tokens are self-contained, only dependency outward is `providers/theme` (would move with it).
