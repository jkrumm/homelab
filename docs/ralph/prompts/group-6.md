# Group 6 — Polish, Sparklines, Drop Recharts

## What You're Doing

Final polish group. Three goals:

1. Ship the **Sparkline Grid** alternative view — a compact per-lift scan.
2. Complete the **naming / subtitle / header-extra audit** across the page so every chart
   conforms to §4.2–§4.3 of the analytics doc.
3. **Remove `recharts`** from the dashboard's dependencies entirely.

After this group, the page is feature-complete for v2 and the entire dashboard (both Strength
Tracker and Garmin Health) is visx-only. The CHARTS-VISX-MIGRATION.md "Drop recharts from
dashboard" pending item gets ticked.

---

## Research & Exploration First

1. Read `docs/STRENGTH-ANALYTICS.md` §4.2 (naming rule), §4.3 (subtitle rule), §4.6 (sparkline
   grid). Read §5 (tier system) for the mental model.
2. Read `docs/CHARTS-VISX-MIGRATION.md` — confirm the "Drop recharts" phase is the one you're
   finishing.
3. Grep for any remaining recharts imports: `grep -r "from 'recharts'" packages/dashboard/src`.
   Should only be in `strength-tracker/charts.tsx` or equivalent (if Group 2 didn't delete it).
4. Check the sparklines directory: `ls packages/dashboard/src/charts/sparklines/`. It's
   currently empty. You'll be the first implementer.
5. Read `.claude/rules/visx-charts.md` section "Basalt-ui extraction" — sparklines are exempt
   from the Legend/Tooltip contract but still must use VX tokens and `useVxTheme`.

---

## What to Implement

### 1. Sparkline kind (`src/charts/sparklines/`)

Create the first sparkline primitive(s). These are tiny inline charts — typically 60–80px wide,
~24–40px tall — with no axes, no legend, no tooltip. They still use `VX` tokens and `useVxTheme`
for the stroke color, but do not participate in `HoverContext`.

Required kinds:

- **`LineSparkline`** — thin line, no fill, optional last-value dot. Props: `data: number[]`,
  `width: number`, `height: number`, `color?: string`.
- **`BarSparkline`** — mini bars for weekly volume. Props: `data: number[]`, `width: number`,
  `height: number`, `color?: string`.

Export from `src/charts/sparklines/index.ts` (a sub-barrel that the main `src/charts/index.ts`
re-exports).

### 2. `StrengthSparklineGrid` component

In `src/pages/strength-tracker/sparkline-grid.tsx`:

```
┌──────────┬──────────┬──────────┬──────────┬──────────┬────────┐
│ Exercise │ 1RM      │ Volume   │ INOL     │ Momentum │ Status │
├──────────┼──────────┼──────────┼──────────┼──────────┼────────┤
│ Bench    │ [spark]  │ [spark]  │ [spark]  │ ▲  +8%   │ green  │
```

- AntD `Table` (small size, no pagination) with one row per active lift.
- Columns: exercise name, 1RM sparkline, Volume sparkline (mini bars), INOL sparkline, momentum
  (▲▲/▲/►/▼/▼▼ + %), status dot (green/yellow/red from Load Quality per-lift breakdown).
- Each sparkline 80×24. Color = `VX.series.<exercise>`.

### 3. Filter-bar view toggle

Extend the existing view toggle in `strength-tracker/index.tsx`:

- Current: `charts` | `history`. Keep both.
- Add: `sparklines` as a third option.
- When `sparklines` is selected, the content area renders `<StrengthSparklineGrid>` instead of
  the hero + 5 sections. The filter bar, workout form sidebar, and RecentRecords all stay.

Persist the selection in `useLocalState` under the key `st-view` (already in `ST_KEYS`).

### 4. Naming / subtitle / header-extra audit

Walk the page once from top to bottom. Verify each chart against the table in
`STRENGTH-ANALYTICS.md` §4.2 and §4.3:

| Chart | Exact title | Exact subtitle | Header extra shape |
|-|-|-|-|
| 1RM Trend | "1RM Trend" | "Am I getting stronger?" | Latest e1RM + arrow |
| Strength Composite | "Strength Composite" | "Is the gain broad-based?" | 3-chip σ readout |
| Weekly Volume | "Weekly Volume" | "Am I progressively overloading?" | Current week kg + band |
| Training Load (ACWR) | "Training Load (ACWR)" | "Am I overloading?" | Today's ratio + zone |
| INOL per Session | "INOL per Session" | "Am I loading smart?" | Last session INOL + zone |
| Momentum | "Momentum" | "Where am I heading next?" | f'(t) %/day + f''(t) sign |
| Relative Progression | "Relative Progression" | "Which lifts are lagging?" | Leader/laggard % |
| Strength Ratios | "Strength Ratios" | "Are my lifts balanced?" | Worst pair + status |
| Readiness × Strain | "Readiness × Strain" | "Am I ready to push?" | Today's score + verdict |
| Training–Recovery Alignment | "Training–Recovery Alignment" | "Does today match my body?" | Today's cell verdict |

Fix any drift. Every `ChartCard` must have both `subtitle` and `tooltip` props. Every chart must
have a header extra — no exceptions. Hero card labels must match their section headers exactly
(§4.2 table).

### 5. Remove recharts from the dashboard

- `grep -r "from 'recharts'" packages/dashboard/src` — should return nothing. If any lingering
  imports exist, migrate them now or delete the code.
- Run `cd packages/dashboard && bun remove recharts`.
- Run `cd packages/dashboard && bun tsc --noEmit` — must pass.
- Run `bun run build` — must pass.
- Update `docs/CHARTS-VISX-MIGRATION.md`: move the "Remove recharts dependency" row from
  ⏳ Pending to ✅ Shipped. Add a final commit row.

### 6. Update documentation

- `packages/dashboard/CLAUDE.md` — the "Chart Patterns" section currently documents Recharts.
  Replace it with a 10-line pointer to `.claude/rules/visx-charts.md` and `docs/GARMIN-HEALTH.md`
  / `docs/STRENGTH-ANALYTICS.md`. Do not inline a visx tutorial here — the rules file is the
  tutorial.
- `.claude/rules/dashboard-patterns.md` — update "1RM Estimation" to reflect the tightened
  function from Group 1 (validity gates, no Mayhew, dynamic bodyweight). Remove "Dual-Axis
  Recharts" section entirely. Remove "Chart Tooltip Styling" if it references the Recharts
  `TOOLTIP_STYLE` constant.
- `docs/STRENGTH-ANALYTICS.md` — update Part 7 to mark all 6 groups as ✅ shipped (keep the
  phase definitions, just add status badges like `CHARTS-VISX-MIGRATION.md` does).
- `docs/ralph/RALPH_REPORT.md` — this is auto-generated by the runner; don't hand-edit.

### 7. Final cross-page sanity

- Both pages (Garmin Health and Strength Tracker) on the dashboard should look and feel like
  siblings — same `ChartCard` shape, same tooltip style, same hero-card pattern, same naming
  discipline.
- Theme toggle works on both pages without page reload.
- Hover sync works within each page (but doesn't cross pages — they're separate `HoverContext`
  providers).

---

## Validation

```bash
bun install && bun run lint
cd packages/api && bun tsc --noEmit
cd packages/dashboard && bun tsc --noEmit && bun run build
bun run format:check  # if script exists

# Must return nothing:
grep -r "from 'recharts'" packages/dashboard/src

# Must return nothing in strength-tracker:
grep -r "@visx/tooltip" packages/dashboard/src/pages/strength-tracker
grep -r "localStorage.getItem.*theme" packages/dashboard/src/pages/strength-tracker

# recharts must not appear in package.json:
grep recharts packages/dashboard/package.json
```

Manual dev-server checks:
- Sparkline grid view renders cleanly — 4 rows (one per active lift), sparklines are crisp, not
  blurry.
- Every chart in the Charts view has a subtitle visible below the title.
- Every chart has a header extra in the top-right of its card.
- Theme toggle on both Garmin and Strength pages — no raw hex bleeds through.
- Final sanity: `bun run dev` console has zero errors on a full tour of the page (all filter
  presets, all view modes).

---

## Commit

Two commits if the doc updates are meaningful enough to separate:

```bash
# Code changes
git add packages/dashboard
git -c commit.gpgsign=false commit --no-verify -m "feat(dashboard): sparkline grid view; drop recharts; naming audit"

# Doc updates
git add docs packages/dashboard/CLAUDE.md .claude/rules
git -c commit.gpgsign=false commit --no-verify -m "docs(dashboard): mark strength-tracker v2 shipped; replace recharts references with visx"
```

If you'd rather a single commit, that's also fine — fewer small commits is preferable per
`~/SourceRoot/claude-local/rules/commit-conventions.md`. Use your judgment.

Fallback per shared-context.md if any commit fails.

---

## Done

Append final notes — celebrate what shipped, flag any tech debt you noticed along the way. Then:

```
RALPH_TASK_COMPLETE: Group 6
```
