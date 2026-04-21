# Group 4 — Balance & Composite Hero

## What You're Doing

Cross-lift comparisons and the three-card hero row. Ship **Relative Progression** (multi-line
normalized %) and **Strength Ratios** (DOTS-adjusted horizontal bars) as Section 4. Replace the
v1 `SummaryStats` row with a three-card `HeroStats` component in the Garmin Health style:
**Strength**, **Load Quality**, **Balance**.

This group is where the dashboard starts feeling like Garmin Health — the answer tier (hero)
snaps into place above the evidence tier (sections).

---

## Research & Exploration First

1. Read `docs/STRENGTH-ANALYTICS.md` §2.4 (relative strength), §2.8 (DOTS ratios), §2.6 (for
   Strength Direction hero), §3.1–§3.3 (all three hero composites), §4.1–§4.2 (layout + naming
   rule).
2. Read `packages/dashboard/src/pages/garmin-health/stats.tsx` — `HeroStats` shape, 3-card
   layout, AntD `Statistic` usage, sub-text pattern, `Tooltip` icons.
3. Read the DOTS coefficient: fetch the official IPF 2020 formula (search "DOTS formula
   powerlifting coefficient 2020" via Tavily or WebSearch — don't trust training data for exact
   coefficients). The formula is:
   ```
   DOTS = 500 / (A + B·x + C·x² + D·x³ + E·x⁴) × kg_lifted
   where x = bodyweight_kg and A–E are sex-specific constants
   ```
   Confirm the current constants from the IPF site or a reputable secondary source before
   coding.
4. Read `packages/dashboard/src/providers/eden.ts` + the user-profile route — confirm how gender
   is retrieved (needed for DOTS coefficient selection).
5. Read the Garmin Health `HeroStats` sub-text pattern — each card has a primary value, a
   verdict label, and sub-text showing the contributing signals.

---

## What to Implement

### 1. DOTS helper (`analytics.ts` or a new `dots.ts`)

```ts
export function dotsCoefficient(bodyWeightKg: number, gender: 'male' | 'female'): number
export function dotsAdjusted(e1RM: number, bodyWeightKg: number, gender: 'male' | 'female'): number
```

- Implement per the IPF 2020 formula. Copy the constants from official source.
- Gender fallback: if `user_profile.gender` is null, default to 'male' and log a console warning
  on page load (one time). Add a settings reminder in `RecentRecords`/sidebar if gender is missing.

### 2. Ratio analytics (`analytics.ts`)

- `strengthRatios(best1RMs: Record<string, number>, bodyWeight: number, gender)` — returns
  normative-range status for each pair defined in §2.8:
  ```
  { deadliftOverSquat: { ratio, range: [1.0, 1.25], status: 'balanced' | 'imbalanced' | 'critical' },
    squatOverBench:    { ratio, range: [1.2, 1.5],  status },
    deadliftOverBench: { ratio, range: [1.5, 2.0],  status },
    pullupOverBw:      { ratio, range: [0.4, 0.7],  status }  // (added_weight / bw) only
  }
  ```
  Use DOTS-adjusted values for every ratio.
- `balanceComposite(ratios)` — returns the worst-offender status and the offending pair.

### 3. `RelativeProgressionChart` — bespoke multi-line

Not a new kind — the shape is specific enough that composing primitives is the right call.

- X-axis: dates across the selected filter range.
- Y-axis: % change vs the e1RM at filter-start date per lift (start = 100%, plot in percentage
  points).
- One line per active lift using `VX.series.<exercise>`.
- Legend-hover dim-others (shipped pattern).
- Subtitle: `"Which lifts are lagging?"`
- Header extra: leader lift + % / laggard lift + % (e.g. "Squat +14% · Pull-ups −3%").

### 4. `StrengthRatiosChart` — bespoke horizontal bars

- One horizontal bar per ratio pair. Layout is stacked rows, not a normal chart grid.
- Each row: label on the left, a horizontal scale behind, a green band for the normative range,
  a colored tick for the current value, status label on the right.
- When a ratio is `imbalanced`, tick is yellow (`VX.warnSolid`); `critical` is red (`VX.badSolid`);
  `balanced` is green (`VX.goodSolid`).
- Subtitle: `"Are my lifts balanced?"`
- Header extra: worst-offender pair + its status (e.g. "Squat/Bench critical · 1.05").

Implementation can be AntD `Progress` + custom CSS, or a small bespoke SVG. The former is
simpler and matches how `bb_highest` renders in Garmin Health's stats. Your call — keep it tidy.

### 5. `HeroStats` (`strength-tracker/stats.tsx` rewrite)

Replace the existing `SummaryStats` 6-card row with a 3-card hero row mirroring Garmin Health's
`HeroStats`. Three cards:

**Card 1 — Strength**
- Primary: direction arrow ▲/►/▼ from `strengthDirection` of the primary active lift.
- Verdict label: "Improving" / "Stable" / "Declining".
- Sub-text: leader lift name + % velocity ("Squat +14% / mo"), and f''(t) sign ("accelerating"
  / "linear" / "decelerating").

**Card 2 — Load Quality**
- Primary: score 0–100 from `loadQualityComposite`.
- Verdict label: "Quality" / "Adequate" / "Poor".
- Sub-text: identify the dragging component (e.g. "INOL avg 1.4 · high") so the user knows why
  the score isn't 100.

**Card 3 — Balance**
- Primary: worst-offender status symbol (✓ / △ / ✗).
- Verdict label: "Balanced" / "Imbalanced" / "Critical".
- Sub-text: offending pair + current ratio (e.g. "Squat/Bench · 1.05").

Each card has the AntD `InfoCircleOutlined` tooltip icon — tooltip text explains the metric
(mirror the tooltip copy style from the v1 `SummaryStats`).

### 6. Page layout update

- `strength-tracker/index.tsx`: replace `SummaryStats` with `HeroStats` above the filter bar's
  content area. Keep the filter bar above the hero.
- Render Section 4 (Balance) under Sections 1–3. Section 5 (Readiness) stays as a placeholder —
  coming in Group 5.

### 7. Naming rule enforcement

Audit the page against `STRENGTH-ANALYTICS.md` §4.2. Every hero card's label matches its section
title matches its chart card title. "Strength", "Load Quality", "Balance" each appear in exactly
one place each. No "Training Load" ambiguity — Load Quality is the hero; Training Load (ACWR) is
one chart inside the Load Quality section.

---

## Validation

```bash
bun install && bun run lint
cd packages/dashboard && bun tsc --noEmit && bun run build
bun run format:check  # if script exists
```

Manual dev-server checks:
- Hero row sits above filter bar (desktop) or above content (mobile stack).
- 3 cards fit one row on desktop (`xs={24} sm={24} md={8}` or similar Garmin-style breakpoints).
  Stacks cleanly on mobile.
- Each card shows the primary value + verdict + sub-text.
- Info tooltip on each card works.
- Relative Progression chart normalizes correctly — the leftmost point for every active lift is
  100%.
- Strength Ratios bars show all four pairs; bands are visible; current ticks are colored by
  status.
- DOTS values look sane — cross-check against a DOTS calculator online for your current 1RMs.
- No console errors. No raw hex. No `@visx/tooltip` imports.

---

## Commit

```bash
git add packages/dashboard
git -c commit.gpgsign=false commit --no-verify -m "feat(dashboard): hero row + Balance section (relative progression, DOTS ratios)"
```

Fallback per shared-context.md if it fails.

---

## Done

Append notes (call out the DOTS constants source you used + any edge cases in gender fallback),
then:

```
RALPH_TASK_COMPLETE: Group 4
```
