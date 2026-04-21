# Visx Migration & Garmin Health Redesign — Implementation Plan

> Phased implementation plan for the Garmin Health page: finish the visx migration, unify the
> effort metric on MET-minutes (Activity Score), reorganise the page for clearer insight flow,
> and refresh the Recovery Score with strain context.
>
> Companion to [GARMIN-HEALTH.md](./GARMIN-HEALTH.md) (analytics reference — the *what* and *why*).
> This doc is the *how* and *when*.

---

## Status Summary

### ✅ Shipped

| # | Phase | Commit summary |
|-|-|-|
| ✅ | AxisRightNumeric primitive | `refactor(dashboard): add AxisRightNumeric primitive` |
| ✅ | Bars kind + migrate Sleep + Activity | `feat(dashboard): Bars kind; migrate Sleep + Activity charts` |
| ✅ | Right-axis margin + dashed legend/tooltip swatches | `fix(dashboard): Bars right-axis margin + dashed legend/tooltip swatches` |
| ✅ | Grouped bar layout in Bars (+ Activity dual-bar) | `feat(dashboard): grouped bar layout in Bars; Activity is now dual-bar` |
| ✅ | Neutral grey for Activity 30d avg | `feat(dashboard): neutral grey for Activity 30d avg line` |
| ✅ | Rebalance Activity — weighted intensity priority | `feat(dashboard): rebalance Activity to favor intensity minutes` |
| ✅ | Equal-width bars + composite 30d Activity trend | `feat(dashboard): equal-width bars + composite Activity 30d trend` |
| ✅ | MET-min Activity Score with stacked Strain bar | `feat(dashboard): MET-minute Activity Score with stacked Strain bar` |
| ✅ | Activity tooltip cleanup | `refactor(dashboard): tighten Daily Activity tooltip` |
| ✅ | Layout reorg (4× 50/50 sections) | `refactor(dashboard): reorganise Garmin Health into 4x 50/50 sections` |
| ✅ | Unify training load on Activity Score (MET-min) | `refactor(dashboard): unify training load on Activity Score (MET-min)` |
| ✅ | Recovery strain-debt factor | `feat(dashboard): Recovery Score factors in yesterday's strain` |
| ✅ | FitnessChart → visx (bespoke dual-axis) | `refactor(dashboard): migrate FitnessChart to visx` |
| ✅ | Body Battery + Stress Levels → visx | `refactor(dashboard): migrate Body Battery and Stress Levels to visx` |
| ✅ | Body Battery + Stress redesign (diverging bars + gradient area) | `refactor(dashboard): redesign Body Battery as energy balance; Stress with gradient area` |
| ✅ | Naming + UX review pass | `refactor(dashboard): align chart/section/hero names; add subtitles + header extras` |
| ✅ | Strength Tracker v2 — full visx rewrite | `feat(dashboard): sparkline grid view; drop recharts; naming audit` |
| ✅ | Remove `recharts` dependency | `feat(dashboard): sparkline grid view; drop recharts; naming audit` |

All phases complete. Both Garmin Health and Strength Tracker are fully on visx. `grep -r recharts packages/dashboard/src` returns nothing. The `recharts` package has been removed from `packages/dashboard/package.json`.

---

## Current Primitives & Kinds

All chart primitives live under `packages/dashboard/src/charts/`. Barrel export at `src/charts/index.ts`.

### `ZonedLine<T>` — single-line with zone backgrounds

Covers ACWR and Recovery. Props: `getX`, `getY`, `yDomain`, `zones`, `thresholds`, `refLines`, `tooltipLabel`, `seriesLabel`, `formatValue`, `renderExtraTooltipRows`.

### `Bars<T>` — stacked or grouped bars + optional lines on dual axes

Drives Sleep (diverging stacked) and Daily Activity (stacked Strain). Full prop surface:

| Prop | Type | Notes |
|-|-|-|
| `positiveBars` | `BarsBar[]` | Bars above baseline (stacked or grouped) |
| `negativeBars?` | `BarsBar[]` | Stacked below baseline — stacked layout only |
| `barLayout?` | `'stacked' \| 'grouped'` | Default `'stacked'` |
| `lines?` | `BarsLine[]` | 0–N lines. Each: `axisSide`, `dashed`, `strokeWidth`, `formatValue` |
| `zones?` | `BarsZone[]` | Horizontal bands. `from/to: -Infinity/Infinity` for "to axis edge" |
| `refLines?` | `BarsRefLine[]` | Dashed/solid horizontal references |
| `leftAxis` / `rightAxis` | `BarsAxisConfig` | Domain `'auto' \| [min,max]`, `autoMaxFloor`, `formatTick`, `numTicks` |
| `barOpacity?` | `(d, key) => number` | Per-bar opacity modulation |
| `renderPrefixTooltipRows?` | `(d) => ReactNode` | Tooltip rows BEFORE generated bar/line rows |
| `renderExtraTooltipRows?` | `(d) => ReactNode` | Tooltip rows AFTER |
| `BarsBar.axisSide?` / `.weight?` | | Per-bar axis + relative width in grouped layout |

Right margin auto-widens to 40px when `rightAxis` is configured.

### Primitives

- `ChartCard` · `ChartLegend` · `ChartTooltip` + `TooltipHeader/Row/Body` · `HoverOverlay`
- `AxisLeftNumeric` · `AxisRightNumeric` · `AxisBottomDate` (all support `tickFormat`)
- Hooks: `useHoverSync<T>` (the closest-point snap + cross-chart broadcast), `useChartTooltip<T>`
- Tokens: `VX` (semantic palette + per-metric series colors), `useVxTheme()` (theme-reactive neutrals)

### Tokens added during Phase 2

- `VX.goodSoft` — `rgba(63, 185, 80, 0.08)` for target-zone bands
- `VX.series.vigorousMin` — `#e65100` (hot orange) for the vigorous segment in Activity

---

## Cross-Cutting Rules (apply to every new chart)

- Use `useHoverSync` for hover. Never reimplement closest-point loops.
- Use `useVxTheme()` for line/axis/tooltip colors. Never `localStorage.getItem('theme')`.
- Use `VX` / `VX.series` for all colors. No raw hex in chart files.
- Every non-sparkline chart wraps in `<ChartCard>` with `tooltip` from `METRIC_TOOLTIPS`.
- Append `<ChartLegend>` outside `<ParentSize>` for every multi-series chart.
- X-scale built from full `data`, not filtered — preserves calendar continuity through nulls.
- Read `.claude/rules/visx-charts.md` and `~/SourceRoot/claude-local/rules/visx-charts.md` before starting any phase.
- One commit per phase. Run `bun run lint && bun tsc --noEmit && bun run format:check` before committing.
- Validate the running dev server in Chrome before ending a phase — `cd packages/dashboard && VITE_API_URL=https://api.jkrumm.com bun run dev` points at prod API.
- Leave the dev server running after your own validation so the user can verify.

---

## After All Phases — Future Work

Explicitly out of scope for this plan but tracked for later:

- **Strength-Tracker migration** — same `Bars` kind covers the future Volume preset (weekly stacked bar + line). Follow-up effort once Garmin Health is fully visx.
- **Insight composites** — Overtraining + Detraining + Alignment signals (documented in `GARMIN-HEALTH.md` Part 3) are defined but not surfaced in the UI. Could live as verdict chips on the hero cards.
- **VO2 Max sparkline in hero card** — currently a static number; adding a 30-day sparkline would show direction.
- **Weight log integration** — unused in analytics today; could feed into Recovery adjustment when available.
