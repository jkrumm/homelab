# Group 5: Linting + Claude Code Enablement

## What You're Doing

Set up oxlint + oxfmt for the monorepo, and create Claude Code rules and documentation so future dashboard pages can be vibe-coded in a single prompt. After this group, `bun lint` and `bun format:check` pass clean, and the CLAUDE.md + rules files enable rapid LLM-assisted development.

---

## Research & Exploration First

1. Read all files in `packages/dashboard/src/` — understand the actual structure that was built
2. Read `packages/api/src/routes/workouts.ts` — understand the actual CRUD pattern
3. Read `packages/api/src/db/schema.ts` — understand the actual Drizzle pattern
4. Read `packages/dashboard/src/providers/data-provider.ts` — understand the actual Eden Treaty provider
5. Read existing `.claude/rules/` in the homelab repo (if any) and in `~/SourceRoot/claude-local/rules/` for pattern reference
6. Read existing `CLAUDE.md` files — understand the documentation convention
7. Research **oxlint** current state:
   - Latest version, installation (`bun add -D oxlint`)
   - Configuration file format (`.oxlintrc.json` or `oxlint.json`)
   - Available rule categories: correctness, suspicious, pedantic, style, restriction, nursery
   - React-specific rules (hooks, JSX)
   - TypeScript-specific rules
   - Import rules
   - Which categories to enable for this stack
8. Research **oxfmt** current state:
   - Is it released? (oxfmt may still be experimental — check current status)
   - If not available: use Prettier as fallback (it's the standard)
   - Configuration format
9. Research what ESLint plugins/rules would be most useful for:
   - Elysia patterns
   - Vite
   - React v19 (new features like `use`, server components awareness)
   - Ant Design (import optimization, component usage)
   - Refine v5 (any Refine-specific linting?)
   - Map these to equivalent oxlint rules where available

---

## What to Implement

### 1. oxlint setup

- Install `oxlint` at workspace root as dev dependency
- Create `.oxlintrc.json` at workspace root:
  - Enable categories: `correctness` (errors), `suspicious` (likely bugs), `pedantic` (best practices)
  - Enable specific useful rules for the stack:
    - React: hooks rules (rules-of-hooks, exhaustive-deps), JSX key, no-direct-mutation
    - TypeScript: no-explicit-any, no-unused-vars, prefer-ts-expect-error
    - Import: no-duplicates, order (if available)
    - General: no-console (warn), eqeqeq, no-var
  - Disable rules that conflict with the codebase patterns (research what makes sense)
- Add `"lint": "oxlint ."` to root `package.json` scripts
- Add `"lint:fix": "oxlint --fix ."` to root `package.json` scripts

### 2. Formatting setup (oxfmt or Prettier)

- Check if oxfmt is stable and released. If yes, use it. If not, use Prettier.
- Configure formatter:
  - Match existing API code style (check: tabs vs spaces, single vs double quotes, semicolons, trailing commas)
  - Print width: 100 or whatever existing code uses
- Add `"format": "<formatter> --write ."` to root `package.json` scripts
- Add `"format:check": "<formatter> --check ."` to root `package.json` scripts

### 3. Fix lint/format violations

- Run linter and formatter on all existing code
- Fix all violations (auto-fix where possible, manual where needed)
- Ensure zero warnings on both packages

### 4. Dashboard CLAUDE.md

Create `packages/dashboard/CLAUDE.md` with:

- Project overview (Refine v5 + Ant Design + Recharts dashboard)
- Directory structure (actual, not planned)
- How to add a new dashboard page end-to-end:
  1. Define Drizzle schema in `packages/api/src/db/schema.ts`
  2. Create CRUD routes in `packages/api/src/routes/<resource>.ts`
  3. Register routes in `packages/api/src/index.ts`
  4. Add Refine resource in `packages/dashboard/src/App.tsx`
  5. Create page in `packages/dashboard/src/pages/<name>/`
  6. Add navigation item in sidebar
- Data provider details (Eden Treaty, how it maps Refine ↔ API)
- Theme system (how to use dark/light mode in components)
- Chart patterns (Recharts conventions used in this project)
- Form patterns (Ant Design form + dynamic fields)
- Mobile responsiveness patterns
- Available scripts (dev, build, lint, format)

### 5. Refine rules file

Create `.claude/rules/refine.md` (in the homelab repo's `.claude/rules/` directory):

- Refine v5 core concepts: resources, data providers, hooks (`useList`, `useOne`, `useCreate`, `useUpdate`, `useDelete`)
- Ant Design v5 integration patterns: `<ConfigProvider>`, theme tokens, Layout/Sider
- Eden Treaty data provider: how it works, how to extend for new resources
- Recharts patterns: `ResponsiveContainer`, dark mode color handling, tooltip formatting
- Common pitfalls (from what was learned in Groups 1-4, check RALPH_NOTES.md)
- Mobile-responsive patterns with Ant Design Grid

### 6. Update root CLAUDE.md

Update `CLAUDE.md` in the repo root to reflect:

- Monorepo structure (packages/api + packages/dashboard)
- New scripts (lint, format)
- Dashboard deployment (container, Caddy route)
- How to develop locally (API + dashboard dev servers)
- Reference to `packages/dashboard/CLAUDE.md` for dashboard-specific conventions

---

## Validation

```bash
# Lint — zero warnings
bun lint

# Format check — zero changes needed
bun format:check

# Typecheck both packages still pass
cd packages/api && bun tsc --noEmit
cd packages/dashboard && bun tsc --noEmit

# Build still works
cd packages/dashboard && bun run build
```

Verify:

- All lint rules make sense for the stack (no false positives on valid patterns)
- Formatting is consistent across both packages
- CLAUDE.md files are accurate to the actual codebase (not aspirational)
- The refine rules file would enable an LLM to generate a new dashboard page correctly

---

## Commit

```
feat(monorepo): add oxlint and formatting configuration

docs(dashboard): add CLAUDE.md and Refine rules for LLM-assisted development

docs: update root CLAUDE.md for monorepo structure
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 5
```
