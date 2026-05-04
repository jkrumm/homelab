# Strength Tracker v2 — RALPH Shared Context

You are implementing the **Strength Tracker v2** rewrite on the homelab dashboard. The analytics
design, composite signals, chart catalogue and phase boundaries are all specified in
[`docs/STRENGTH-ANALYTICS.md`](../STRENGTH-ANALYTICS.md). **Read that document end-to-end before
starting your group.** It is the source of truth; if this file conflicts with it, it wins.

The pattern reference for everything you build is the Garmin Health page
([`docs/GARMIN-HEALTH.md`](../GARMIN-HEALTH.md), code under
`packages/dashboard/src/pages/garmin-health/`). The migration that produced that page is documented
in [`docs/CHARTS-VISX-MIGRATION.md`](../CHARTS-VISX-MIGRATION.md). If you find yourself inventing
a new pattern, stop and copy the Garmin equivalent first.

---

## What You're Building

A periodization instrument for the key compound lifts (bench / squat / deadlift / weighted
pull-ups, extensible via the `exercises` reference table). Replaces the v1 Recharts-based
workout-tracker page with a visx-based dashboard answering five questions:

1. Am I getting stronger on the lifts I care about?
2. Am I loading smart or just hard?
3. Are my lifts balanced?
4. Should I push, sustain, or deload today?
5. When should I deload?

All analytics are client-side — the API returns raw rows plus a few per-workout aggregates. Every
chart uses visx primitives. No recharts. No raw hex. No `@visx/tooltip` imports.

---

## Repository Layout (what exists today)

```
homelab/                                       # Bun workspace monorepo
├── packages/
│   ├── api/                                   # Elysia API (port 4000, bun:sqlite)
│   │   └── src/
│   │       ├── db/{index,schema}.ts           # Drizzle schema — already has workouts, workout_sets,
│   │       │                                     daily_metrics, weight_log, user_profile
│   │       ├── routes/                        # CRUD: workouts, workout-sets, daily-metrics,
│   │       │                                     weight-log, user-profile + integrations
│   │       └── index.ts                       # App entry, auth guard, plugin registration
│   └── dashboard/                             # Refine v5 + AntD v5 + visx + React 19
│       └── src/
│           ├── charts/                        # Visx primitives, kinds, tokens, hooks
│           │   ├── tokens.ts                  # VX palette + VX.series per-metric colors
│           │   ├── theme.tsx                  # useVxTheme() — theme-reactive neutrals
│           │   ├── hover-context.ts           # HoverContext for cross-chart sync
│           │   ├── primitives/                # ChartCard, ChartLegend, ChartTooltip, Axes,
│           │   │                                HoverOverlay, ZoneRects
│           │   ├── kinds/{Bars,ZonedLine}.tsx # Reusable chart shapes
│           │   ├── hooks/                     # useChartTooltip, useHoverSync
│           │   └── utils/{format,ticks}.ts
│           ├── pages/
│           │   ├── garmin-health/             # REFERENCE IMPLEMENTATION — study this first
│           │   │   ├── index.tsx              # Layout, HoverContext provider, section grid
│           │   │   ├── visx-charts.tsx        # All 8 charts using primitives/kinds
│           │   │   ├── stats.tsx              # Hero cards (composite)
│           │   │   ├── utils.ts               # Client-side analytics
│           │   │   ├── constants.ts
│           │   │   └── types.ts
│           │   └── strength-tracker/          # v1 — you are rewriting this
│           │       ├── index.tsx              # Page shell + filter bar
│           │       ├── charts.tsx             # Recharts (being replaced)
│           │       ├── stats.tsx              # Existing summary stat cards
│           │       ├── workout-form.tsx       # Sidebar form — KEEP unchanged
│           │       ├── history.tsx            # Workout list view
│           │       ├── records.tsx            # Recent PR sidebar — KEEP
│           │       ├── set-editor.tsx         # Row editor — KEEP
│           │       ├── achievements.ts
│           │       ├── constants.ts
│           │       ├── demo-data.ts
│           │       ├── types.ts
│           │       ├── use-local-state.ts     # ST_KEYS prefix pattern
│           │       └── utils.ts               # e1RM formulas, metrics, time-series
│           ├── providers/
│           │   ├── eden.ts                    # Eden Treaty client
│           │   ├── data-provider.ts           # Refine DataProvider (maps to API)
│           │   └── theme.tsx                  # ThemeProvider + useTheme
│           └── App.tsx                        # Refine config + routes + sidebar
├── docs/
│   ├── STRENGTH-ANALYTICS.md                  # SOURCE OF TRUTH — the plan
│   ├── GARMIN-HEALTH.md                       # Analytics reference to mirror
│   ├── CHARTS-VISX-MIGRATION.md               # How Garmin Health was migrated
│   └── ralph/                                 # This loop
│       ├── shared-context.md                  # This file
│       ├── RALPH_NOTES.md                     # Append after every group
│       └── prompts/group-{1..6}.md
├── .claude/rules/
│   ├── dashboard-patterns.md                  # Dashboard-specific conventions
│   ├── refine.md                              # Refine v5 + AntD + Eden Treaty
│   └── visx-charts.md                         # VISX PRIMITIVE CONTRACT — read this
└── CLAUDE.md + packages/dashboard/CLAUDE.md   # Project conventions
```

The API, monorepo, auth, deployment and everything else already work. This loop only rewrites the
`strength-tracker` page (and adds the `exercises` reference table + RIR to the schema in Group 1).

---

## Tech Stack

| Concern | Choice |
|-|-|
| Runtime | Bun (workspace monorepo) |
| API framework | Elysia v1.4+ |
| Database | SQLite via `bun:sqlite` (no migrations — greenfield, use `CREATE TABLE IF NOT EXISTS`) |
| ORM | Drizzle |
| Dashboard framework | Refine v5 + React 19 + Ant Design v5 + Vite |
| Charts | **visx** (recharts is being removed in Group 6) |
| API client | Eden Treaty (`treaty<App>(API_URL)`) |
| Linting | oxlint |
| Formatting | oxfmt (or prettier — check `package.json` scripts) |
| Auth | Bearer token (Caddy injects it) |

---

## Validation Commands

**Primary — run after every group:**

```bash
# From repo root
bun install                                # workspace resolution
bun run lint                               # oxlint — zero warnings/errors expected
cd packages/api && bun tsc --noEmit        # API typecheck
cd packages/dashboard && bun tsc --noEmit  # Dashboard typecheck
```

**Formatting — apply, then check:**

```bash
bun run format        # applies oxfmt — ALWAYS run this before git add / commit
bun run format:check  # sanity check — must return clean
```

**This is not optional.** `bun run format:check` is part of post-group validation and will fail
the loop if unformatted files sneak through. Always `bun run format` *first*, then stage + commit.

**Dashboard build (for groups that touch the page):**

```bash
cd packages/dashboard && bun run build
```

**Manual in-browser validation (required before emitting completion signal):**

You CANNOT do this from the headless runner — but your workflow is:

1. Start the dev server: `cd packages/dashboard && VITE_API_URL=https://api.jkrumm.com bun run dev`
   (strict port 5173 — use `npx kill-port 5173` first if needed)
2. Dev server points at the production API so you get real data.
3. Open `https://dashboard.test/strength-tracker` (Caddy proxy) or `http://localhost:5173`.
4. Verify charts render, hover-sync works, theme toggle works, no console errors.
5. Leave the dev server running when you finish the group — the user will re-verify.

**There is no test suite.** Do not add unit tests. Rely on typecheck + lint + visual verification.

---

## Source of Truth Priority

When you have a question, consult in this order. Stop at the first source that answers:

1. **`docs/STRENGTH-ANALYTICS.md`** — *what* to build: metrics, formulas, composites, chart catalogue, naming rule, subtitle rule, phase boundaries
2. **`docs/GARMIN-HEALTH.md`** + `packages/dashboard/src/pages/garmin-health/` — *how* to build it: patterns, code references, component contracts
3. **`.claude/rules/visx-charts.md`** + **`~/SourceRoot/dotfiles/rules/visx-charts.md`** — *primitive contract*: what's mandatory, what's banned
4. **`.claude/rules/dashboard-patterns.md`** + **`.claude/rules/refine.md`** — dashboard/Refine conventions
5. **This file** — RALPH-specific conventions (commits, completion, notes)
6. **`packages/dashboard/CLAUDE.md`** + repo-root `CLAUDE.md` — project norms

If a group prompt contradicts the analytics doc, the analytics doc wins — treat the group prompt
as direction, not prescription.

---

## Mandatory Visx Conventions (non-negotiable)

From `.claude/rules/visx-charts.md`, enforced by code review and (in some cases) by oxlint:

- **Every non-sparkline chart** wraps in `<ChartCard>` with a `subtitle` prop (the 6-word question)
  and a `METRIC_TOOLTIPS.*` entry on the `tooltip` prop.
- Chart body goes inside `<ParentSize debounceTime={100}>{({ width }) => …}</ParentSize>`.
- `<ChartLegend>` is **outside** `<ParentSize>`, appended as a sibling.
- Use `useHoverSync<T>` for mouse tracking. Never reimplement the closest-point loop.
- Use `useVxTheme()` for neutrals (line, axis, tooltip bg). Never `localStorage.getItem('theme')`.
- All colors from `VX` or `VX.series.*`. **No raw hex literals** in any chart file.
- Axes: `AxisLeftNumeric`, `AxisRightNumeric`, `AxisBottomDate`. Never raw `@visx/axis` components.
- Tooltips: `ChartTooltip` + `TooltipHeader` / `TooltipRow` / `TooltipBody`. **Never import from
  `@visx/tooltip`** — oxlint bans it in chart files.
- `xScale` domain built from **all** data points (including nulls), not a filtered subset —
  preserves calendar continuity.
- Page must wrap in `<HoverContext.Provider>` for cross-chart crosshair sync.

If a chart shape needs something the primitives don't offer, **extend `Bars` or add a kind under
`charts/kinds/`** — but only once the same shape appears twice (Rule of Three). A bespoke one-off
composes primitives directly inside the page's `visx-charts.tsx`, like `DivergenceChartInner` in
Garmin Health.

---

## Research Before Implementing

Your group prompt is direction, not prescription. Before writing code:

1. **Read `docs/STRENGTH-ANALYTICS.md`** — cover to cover if it's your first group.
2. **Read the Garmin Health equivalent** of what you're building. Every chart in Strength has a
   close pattern counterpart in Garmin. Copy the pattern first, then adapt.
3. **Read the existing v1 code** before deleting it — the workout-form, history view, PR
   detection with 1.5s fade-in, and auto-load-last-session UX all stay. Only the charts page
   (`charts.tsx`) and the summary stats card design are being rewritten.
4. **Grep the chart primitive barrel** (`src/charts/index.ts`) before inventing anything — the
   primitive is probably already there.
5. **Check library versions** from `package.json` before assuming APIs — do not guess versions
   from your training data.

---

## Commit Instructions (CRITICAL — unattended-safe)

This loop runs unattended. The human's 1Password SSH agent will NOT be available to sign commits,
and interactive pre-commit hooks may also prompt for credentials. **Use these exact flags for
every commit in every group:**

```bash
# Step 1 — ALWAYS format first. Skipping this will fail post-group validation.
bun run format

# Step 2 — stage only files you modified (not `git add -A` or `git add .`)
git add <specific files>

# Step 3 — commit with GPG signing disabled and pre-commit hooks skipped.
# This is explicitly authorized by the human for this RALPH loop.
git -c commit.gpgsign=false commit --no-verify -m "feat(dashboard): <description>"
```

**Fallback if commit still fails for any reason (identity issue, tooling error, etc.):**

1. Do NOT retry with different flags or config tweaks.
2. Append to `docs/ralph/RALPH_NOTES.md` under a `### Commit notes` subsection:
   ```
   Commit FAILED for Group N. Changes are staged / unstaged as follows: <describe>.
   Reason: <one line from the error>. Human will commit manually after review.
   ```
3. Emit the normal `RALPH_TASK_COMPLETE: Group N` signal and finish. Do not block the loop.

**Scope:** use `dashboard` when only dashboard files change. Use `api` when only API changes.
When both change (Group 1 is the only one that does this), two separate commits in this order:
`feat(api): ...` first, then `feat(dashboard): ...`.

**Conventional commit types:**

- `feat(...)` — visible changes (new charts, new hero card, new API field)
- `refactor(...)` — migration, rename, move (Recharts → visx)
- `chore(...)` — dependency drops, config tweaks
- `docs(...)` — documentation-only changes

Do NOT push. Do NOT deploy. Commits stay local; the human reviews and pushes after the loop.

---

## Learning Notes — Append After Every Group

After completing each group, **always append** to `docs/ralph/RALPH_NOTES.md`:

```markdown
## Group N: <title>

### What was implemented
<1–3 sentences — the shipped capability, not a task list>

### Deviations from prompt
<what you changed relative to the prompt and why — if none, write "None.">

### Gotchas & surprises
<anything unexpected — primitive-contract edge cases, Refine/AntD quirks, visx tooltips, library versions>

### Commit notes
<only if commit failed — see fallback above. Otherwise write "Committed cleanly.">

### Future improvements
<deferred work, patterns worth extracting later, better approaches you noticed>
```

These notes are institutional memory — future you will read them. Don't skip.

---

## Completion Signal

Output exactly one of these as the **very last line** of your response:

```
RALPH_TASK_COMPLETE: Group N
```

If you cannot proceed due to an unresolvable blocker:

```
RALPH_TASK_BLOCKED: Group N - <reason in one sentence>
```

Do not emit the signal inside a code block, quote, or list. It must be plain text on its own line.
