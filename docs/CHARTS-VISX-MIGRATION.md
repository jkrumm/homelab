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

### ⏳ Pending (in order of suggested shipping)

| # | Phase | Risk | Files touched |
|-|-|-|-|
| 1 | Activity tooltip cleanup | Tiny | `pages/garmin-health/visx-charts.tsx` |
| 2 | Layout reorg (4× 50/50) | Tiny | `pages/garmin-health/index.tsx` |
| 3 | Unify `computeTrainingLoad` on MET-min | Medium | `pages/garmin-health/utils.ts` |
| 4 | Recovery strain-debt factor | Medium | `pages/garmin-health/utils.ts`, hero card |
| 5 | Migrate Fitness Trends to visx | Medium | bespoke in `visx-charts.tsx`; delete `charts.tsx` entry |
| 6 | Migrate Body Battery to visx | Medium | bespoke in `visx-charts.tsx`; delete `charts.tsx` entry |
| 7 | Migrate Stress Levels to visx | Medium | bespoke in `visx-charts.tsx`; delete `charts.tsx` entry |
| 8 | Remove recharts, finalise docs | None | `package.json`, `pages/garmin-health/charts.tsx` (delete) |

Each is one atomic commit. Phases 1+2 are ~10 min; 3–4 are substantive data changes; 5–7 are the remaining visx migrations; 8 is cleanup.

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

## Pending Phases — Detailed Prompts

Each phase is self-contained. Copy the prompt into a fresh Claude Code task and it should run.

### Phase 1 — Activity tooltip cleanup

**Mission:** trim the Daily Activity tooltip from 9 rows to 5. The Score moves to the header (where today's score chip already lives); drop the duplicate raw-vs-MET rows.

**Current tooltip (busy, duplicative):**
```
[Apr 17 2026]
Score        764 · 127%
Walking      192
Moderate     204
Vigorous     368
30d avg      292 · 49%
─────────
Vigorous min 46 min
Moderate min 51 min
Steps        16,089
```

**Target tooltip (focused):**
```
[Apr 17 2026 · 764 · 127%]   ← header label with score (goodSolid if ≥600)
Vigorous     46 min
Moderate     51 min
Steps        16,089
30d avg      292 · 49%
```

**Files:** `packages/dashboard/src/pages/garmin-health/visx-charts.tsx` — `ActivityBarChart` only.

**Implementation notes:**
- Pass `tooltipLabel={(d) => ({ text: `${Math.round(d.score)} · ${pct}%`, color: d.score >= 600 ? VX.goodSolid : tooltipMuted })}` — puts Score in the header's right-aligned label slot.
- Drop `renderPrefixTooltipRows` (Score no longer in the body).
- Replace `renderExtraTooltipRows` with three plain `<TooltipRow shape="dot" color={line2}>` rows for Vigorous min / Moderate min / Steps.
- The 30d avg row is auto-generated from the `lines` array — no change.
- Don't remove the Vigorous/Moderate/Walking MET-min contributions from the BAR (stack still shows them visually) — only from the tooltip.

**Acceptance:**
- [ ] Tooltip shows exactly 5 rows in the expected order.
- [ ] Score appears in the tooltip header, colour-coded vs 600 target.
- [ ] No duplicate Walking/Moderate/Vigorous rows.
- [ ] Header chip outside the card (existing `extra={...}`) stays.
- [ ] `bun run lint && bun tsc --noEmit` clean.

**Commit:** `refactor(dashboard): tighten Daily Activity tooltip`

---

### Phase 2 — Layout reorg to 4× 50/50 sections

**Mission:** restructure `pages/garmin-health/index.tsx` so Daily Activity is promoted 50/50 next to Fitness Trends, and the awkward 33/33/33 supporting row is eliminated.

**Before:**

```
Section 1 — Fitness Progression          [ FitnessChart full-width ]
Section 2 — Training Load                [ ACWR | Divergence ]
Section 3 — Recovery & Sleep             [ Recovery | Sleep ]
Section 4 — Supporting Metrics           [ BB | Stress | Activity ]
```

**After:**

```
Section 1 — Effort & Adaptation          [ Daily Activity | Fitness Trends ]
Section 2 — Training Load                [ ACWR | Divergence ]
Section 3 — Recovery & Sleep             [ Recovery | Sleep ]
Section 4 — Body State                   [ Body Battery | Stress Levels ]
```

**Files:** `packages/dashboard/src/pages/garmin-health/index.tsx` — rearrange section JSX. Rename section titles to match new pairings. Use `Col xs={24} lg={12}` uniformly.

**Acceptance:**
- [ ] Activity renders 50/50 on desktop; stacks on mobile as before.
- [ ] All four rows have exactly two cards (or one if the data flag hides a side).
- [ ] `hasActivityData` gate still applies.
- [ ] No card renders at 33% on desktop.
- [ ] Visual parity with the original colour/chart content — only positions change.

**Commit:** `refactor(dashboard): reorganise Garmin Health into 4× 50/50 sections`

---

### Phase 3 — Unify effort metric on MET-min (computeTrainingLoad)

**Mission:** one definition of "effort" for the entire page. `computeTrainingLoad` switches from `mod×1.0 + vig×1.8` to the Daily Activity Score (walking + moderate + vigorous in MET-min). ACWR and Load Divergence inherit the new load input for free.

**Current formula** (`utils.ts::computeTrainingLoad`):
```
daily_load = moderate_intensity_min × 1.0 + vigorous_intensity_min × 1.8
```

**New formula:**
```
daily_load = activityComponents(steps, moderate_min, vigorous_min).total
           = walking_score + moderate_score + vigorous_score
```

Reuse the existing `activityComponents` helper already in `utils.ts` (added in the Strain commit).

**Files:** `packages/dashboard/src/pages/garmin-health/utils.ts`.

**Keep:**
- EWMA math (λ_acute, λ_chronic, seed).
- ACWR ratio thresholds (0.8 / 1.3 / 1.5) — still valid as relative zones.
- `TrainingLoadPoint` shape — only the number magnitudes change (200–800 range instead of 0–100).
- Divergence histogram logic.

**Optional:** update `docs/GARMIN-HEALTH.md` Part 2.4 prose to reflect the new load input (this doc already describes it as MET-min).

**Acceptance:**
- [ ] ACWR chart shows ratios in the expected 0.5–1.5 range (verify visually).
- [ ] Divergence chart reads comparably (acute/chronic lines well-scaled).
- [ ] Days with only walking (no intensity) now contribute to chronic load — not zero.
- [ ] No UI tuning needed — zones are ratios, scale-invariant.
- [ ] Hover-sync across ACWR ↔ Divergence ↔ Activity still works.
- [ ] Lint + typecheck clean.

**Risk:** historical ACWR values shift because the underlying load definition changed. Explain in commit body — this is the intended behaviour, not a bug.

**Commit:** `refactor(dashboard): unify training load on Activity Score (MET-min)`

---

### Phase 4 — Recovery Score gets strain-debt context

**Mission:** Recovery honestly accounts for yesterday's strain. A "97 Push hard" verdict after a 113-min vigorous day is misleading.

**Change in `computeRecoveryScore`:**

```
recovery_raw = (current weighted composite — unchanged)

strain_debt  = clamp(0, 1, yesterday_score / 1000)
recovery     = recovery_raw × (1 − strain_debt × 0.20)
```

Max penalty 20% at yesterday's score = 1000 (maximum-effort day). Typical hard day ≈ 700 → shaves ~14%.

**Signature change:** `computeRecoveryScore` now needs `yesterday_score: number | null` (or the full `ActivityComponents` for yesterday). Accept as new parameter; nulls → no penalty.

**Files:**
- `packages/dashboard/src/pages/garmin-health/utils.ts` — extend `computeRecoveryScore` signature and `buildRecoveryTrendData` to pass yesterday's score per row.
- Hero card wiring (`stats.tsx` or wherever recovery hero is computed) — pass yesterday's score.
- `docs/GARMIN-HEALTH.md` Part 2.7 — already describes the proposed formula; confirm prose matches implementation.

**Acceptance:**
- [ ] Rest-day-after-rest-day recovery unchanged from current behaviour.
- [ ] Recovery drops by 10–20% on days that follow a 700–1000 MET-min day.
- [ ] `Push / Normal / Rest` zone boundaries unchanged.
- [ ] Tooltip shows the raw vs adjusted score for transparency (optional).

**Commit:** `feat(dashboard): Recovery Score factors in yesterday's strain`

---

### Phase 5 — Migrate FitnessChart (bespoke dual-axis)

**Mission:** rebuild the dual-axis line + line + dot-scatter chart in visx. Single instance — don't extract a kind.

**Files:**
- `pages/garmin-health/visx-charts.tsx` — add `FitnessTrendChart`.
- `pages/garmin-health/charts.tsx` — delete `FitnessChart`.
- `pages/garmin-health/index.tsx` — swap import.

**Visual (unchanged from current Recharts version):**
- Left axis: RHR (bpm) — inverted if recharts does it (lower = higher y); decide if we keep inversion or standardise.
- Right axis: HRV (ms) + VO2 Max (shared right axis).
- Lines: `rhrMA` left axis, `hrvMA` right axis — both 7-day moving average, 2.5px, `curveMonotoneX`.
- VO2 Max: circles only (no connecting line), 5px radius, white stroke, `VX.series.vo2max` fill.
- Header chip: VO2 / RHR delta / HRV delta.

**Pattern:** follow `DivergenceChartInner` in `visx-charts.tsx` for bespoke composition. Two scales (left + right). One `useHoverSync` on the longest series.

**Acceptance:**
- [ ] Theme toggle re-renders correctly.
- [ ] Cursor sync across all other charts.
- [ ] VO2 Max dots appear only where `vo2_max !== null`.
- [ ] Tooltip shows RHR/HRV 7d averages + VO2 Max if present.
- [ ] Header summary chip unchanged.
- [ ] Uses `AxisLeftNumeric` + `AxisRightNumeric` — no raw `<AxisLeft>`/`<AxisRight>`.
- [ ] No raw hex colors — uses `VX.series.restingHr`, `VX.series.hrv`, `VX.series.vo2max`.

**Commit:** `refactor(dashboard): migrate FitnessChart to visx`

---

### Phase 6 — Migrate BodyBatteryChart (bespoke range band)

**Mission:** rebuild the high-low range-band area chart in visx. Use `<Threshold>` from `@visx/threshold` to render the filled band.

**Files:**
- `pages/garmin-health/visx-charts.tsx` — add `BodyBatteryRangeChart`.
- `pages/garmin-health/charts.tsx` — delete `BodyBatteryChart`.
- `pages/garmin-health/index.tsx` — swap import.

**Visual:**
- Filled band between `low` and `high` — `VX.series.bodyBatteryHigh` at 0.25 opacity.
- Top edge (high): solid 2px line, `VX.series.bodyBatteryHigh`.
- Bottom edge (low): dashed 1.5px line, `VX.series.bodyBatteryLow`.
- Reference line at y=50 (dashed, faint red — keep current).
- Y-domain fixed `[0, 100]`.
- Tooltip: Morning Low, Daily High, Charged delta if available.

**Implementation:** `<Threshold>` with `y0=low`, `y1=high`, `belowAreaProps={{ fill: VX.series.bodyBatteryHigh, fillOpacity: 0.25 }}`.

**Acceptance:**
- [ ] Band visible across both themes.
- [ ] Cursor sync works.
- [ ] No regression vs today's tooltip content.

**Commit:** `refactor(dashboard): migrate BodyBatteryChart to visx`

---

### Phase 7 — Migrate StressChart (bespoke area + line + refs)

**Mission:** rebuild the area + line + reference-line chart in visx. Single y-axis 0–100.

**Files:**
- `pages/garmin-health/visx-charts.tsx` — add `StressLevelsChart`.
- `pages/garmin-health/charts.tsx` — delete `StressChart`.
- `pages/garmin-health/index.tsx` — swap import.

**Visual:**
- Filled area: `avgStress` — `VX.series.stress`, fillOpacity 0.15, 2px stroke.
- Overlay line: `sleepStress` — `VX.series.sleepStress`, 1.5px, no fill.
- Ref lines: y=25 (faint green dashed), y=50 (faint warn dashed).
- Tooltip: Avg stress + Sleep stress.

**Acceptance:**
- [ ] Theme toggle works.
- [ ] Cursor sync works.
- [ ] Ref lines visible.

**Commit:** `refactor(dashboard): migrate StressChart to visx`

---

### Phase 8 — Cleanup + doc finalisation

**Mission:** delete `charts.tsx`, drop `recharts` from `package.json`, finalise `GARMIN-HEALTH.md` implementation status.

**Files:**
- `pages/garmin-health/charts.tsx` — DELETE the file. Confirm no residual imports anywhere.
- `packages/dashboard/package.json` — remove `recharts` from `dependencies`.
- `bun install` — regenerate `bun.lockb`.
- `docs/GARMIN-HEALTH.md` — flip all remaining `⏳ pending` rows in Part 6 to `✅ done`.

**Acceptance:**
- [ ] `grep -r recharts packages/dashboard/src` returns nothing.
- [ ] `bun run lint && bun tsc --noEmit` clean.
- [ ] Page renders all 8 charts after `make dash-deploy`.

**Commit:** `chore(dashboard): remove recharts; finalise Garmin Health migration`

---

## Cross-Cutting Rules (apply to every phase)

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
