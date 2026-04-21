# Group 5 — Readiness & Deload

## What You're Doing

Wire the strength page into the existing Garmin wearable data. Ship **Readiness × Strain** (reuse
Garmin's recovery chart with a fatigue-debt adjustment) and the **Training–Recovery Alignment**
matrix (bespoke calendar/heatmap). Compute the multi-signal **Deload Signal** per §3.5 and surface
it as a banner above the hero row when triggered. Swap the third hero card from **Balance** to
**Readiness** when wearable data is present — Balance moves into its own section below.

This group is gated on the user having at least some rows in `daily_metrics`. If the current
date range returns zero daily_metrics rows, the entire readiness section (and its hero card
swap) is hidden — same pattern as Garmin Health's `hasHeartData` / `hasSleepData` guards.

---

## Research & Exploration First

1. Read `docs/STRENGTH-ANALYTICS.md` §3.4 (Readiness × Strain), §3.5 (Deload Signal), §4.5
   (Training–Recovery Alignment chart spec).
2. Read `docs/GARMIN-HEALTH.md` §2.7 (Recovery Score formula + strain-debt adjustment) — the
   readiness number we consume.
3. Read `packages/dashboard/src/pages/garmin-health/utils.ts` — specifically the `computeRecovery`
   function. Look for an exported helper; if not, extract one. You need to be able to reuse it
   from the strength page without duplicating logic.
4. Read `packages/dashboard/src/pages/garmin-health/visx-charts.tsx` — `RecoveryThresholdChart`.
   Study its zone bands, threshold fills, and tooltip shape.
5. Read the Garmin Health overtraining signal definition in `GARMIN-HEALTH.md` §3.1. Your deload
   signal is a peer — same multi-signal AND-pattern.

---

## What to Implement

### 1. Reuse the Garmin Recovery computation

- If `computeRecovery` (or equivalent) in Garmin's `utils.ts` isn't exported, refactor: export
  it. Don't duplicate the 0–100 recovery formula on the strength side.
- In `strength-tracker/analytics.ts`, add:
  ```ts
  export function fatigueDebtAdjustedRecovery(
    recoveryGarmin: number,
    recentWorkouts: Workout[],
    bodyWeight: (date: string) => number,
    today: string,
  ): number
  ```
  Per §3.4:
  - `fatigue_ceiling = max(1.0, p90(inol_per_session over last 90d))`
  - `yesterday_inol = INOL of the most recent session within last 2 days` (or null)
  - `fatigue_debt = clamp(0, 1, yesterday_inol / fatigue_ceiling)`
  - `readiness_strength = recoveryGarmin × (1 − fatigue_debt × 0.25)`
  - Additional: if a session in the last 48h had INOL > 1.2, apply a further 10% dampening.
  Document the stacking order in a comment.

### 2. `ReadinessStrainChart` — reuse `RecoveryThresholdChart`

- Same zones as Garmin (Push ≥ 70, Normal 40–69, Rest < 40).
- Plot the `fatigueDebtAdjustedRecovery` series per day over the selected range.
- Subtitle: `"Am I ready to push?"`
- Header extra: today's score + verdict (Push / Normal / Rest).
- Optional: render a small dot (`VX.badSoft`) annotation on days where `fatigue_debt > 0.25` to
  make the penalty visible.

### 3. `TrainingRecoveryAlignmentChart` — bespoke matrix

A 3×3 grid (not 5×5 — simpler and readable):

```
             ACWR Under  ACWR Optimal  ACWR Caution/Danger
Rec High     Waste       Aligned Push  Misaligned Risk
Rec Normal   Light       Aligned       Overload Risk
Rec Low      Aligned Rest Misaligned   Critical Risk
```

Render as a 3×3 SVG grid of cells. Each cell:
- Filled with `VX.goodSoft` / `VX.warnSoft` / `VX.badSoft` depending on the verdict type.
- Today's (recovery, ACWR) cell highlighted with a thicker border.
- Cell label = verdict name + count of sessions in the selected range that fell in that cell.
- Tooltip on hover: list the dates of those sessions.

Use `ChartCard` as the wrapper. No `useHoverSync` needed — this chart isn't time-series, so it
doesn't participate in the date-crosshair sync. That's fine — hover-sync is only required for
time-series charts.

- Subtitle: `"Does today match my body?"`
- Header extra: today's cell verdict ("Aligned · Push").

### 4. Deload signal + banner

Compute per §3.5 — this is a page-level signal, not per-chart:

```ts
export function deloadSignal(workouts, dailyMetrics, activeExerciseIds, today): {
  verdict: 'deload' | 'monitor' | 'progress',
  activeSignals: string[],      // which of the 4 are firing
  physioAvailable: boolean,     // true iff daily_metrics provided the physio signal
}
```

Logic: each of the 4 signals in §3.5 evaluates independently. Verdict = 'deload' when ≥2 are
active, 'monitor' when 1 is active, 'progress' when 0. "Progress mode for >8 weeks" is a soft
override — if verdict = 'progress' AND the user has been in that state for 56+ days, bump to
'monitor' with signal label "prolonged accumulation — proactive deload recommended".

Render a banner above the hero row:

- Verdict = 'deload' → AntD `Alert` with `type="warning"`, message "Deload recommended", sub-text
  listing the active signals.
- Verdict = 'monitor' → AntD `Alert` with `type="info"`, message "Monitor — 1 stressor active",
  sub-text naming it.
- Verdict = 'progress' → render nothing (quiet state is the healthy state).

### 5. Hero card swap

When `daily_metrics` has any rows in the selected range (mirror Garmin's `hasRecoveryData`
guard):

- Hero row becomes: **Strength** · **Load Quality** · **Readiness** (instead of Balance).
- Balance moves into its own section below the hero — still renders, just not in the hero row.
- Readiness card shape: primary = score 0–100, verdict label = Push / Normal / Rest, sub-text =
  the biggest driver ("HRV 15% below baseline" or "Fatigue debt 0.6 · hard session yesterday").

When no daily_metrics → keep the Group 4 hero row (Strength · Load Quality · Balance) and hide
the entire Readiness section. The deload banner still renders — its fallback logic in §3.4 works
without wearable data.

### 6. Page layout update

Section 5 (Readiness) renders when wearable data is present. It contains Readiness × Strain +
Training–Recovery Alignment in a 50/50 row. When there's no data, the entire section is removed
from the DOM (not hidden via CSS). The deload banner always evaluates.

---

## Validation

```bash
bun install && bun run lint
cd packages/dashboard && bun tsc --noEmit && bun run build
bun run format:check  # if script exists
```

Manual dev-server checks:
- With production data (dev server points at `api.jkrumm.com`), Readiness × Strain renders and
  shows a score that roughly matches Garmin Health's current reading (small divergence expected
  due to fatigue-debt adjustment).
- Alignment matrix renders 3×3 with today's cell highlighted.
- Deload banner appears or not depending on real data state — test by temporarily setting the
  `activeSignals` check thresholds lower to force a deload verdict, then revert.
- Hero row has 3 cards with Readiness as card 3 when wearable data is present.
- Switch date preset to a range with no daily_metrics data — Readiness section disappears, hero
  falls back to Balance as card 3. Banner still evaluates (with physio signal unavailable).
- Cross-chart hover still works: hovering 1RM Trend still draws a crosshair on Readiness ×
  Strain.

---

## Commit

```bash
git add packages/dashboard
git -c commit.gpgsign=false commit --no-verify -m "feat(dashboard): readiness × strain, deload banner, training–recovery alignment matrix"
```

Fallback per shared-context.md if it fails.

---

## Done

Append notes (especially on any refactor of Garmin `computeRecovery` for cross-page reuse), then:

```
RALPH_TASK_COMPLETE: Group 5
```
