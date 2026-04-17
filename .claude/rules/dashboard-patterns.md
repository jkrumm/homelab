---
paths:
  - packages/dashboard/**
---

# Dashboard Patterns

Project-specific conventions for the homelab dashboard. For Refine/AntD/Recharts basics, see `refine.md`.

## useLocalState Hook

localStorage-backed state hook used for persisted UI preferences:

```ts
const [value, setValue] = useLocalState<T>('st-key-name', defaultValue)
```

- All keys prefixed `st-` and registered in `ST_KEYS` array (`use-local-state.ts`)
- `resetConfig()` clears all registered keys and reloads the page
- When adding a new persisted preference, add the key to `ST_KEYS`

## Ant Design App Context

Always use `App.useApp()` for `message` and `notification` — never import them directly:

```ts
const { message } = App.useApp()
message.success('Saved!')
```

Direct imports bypass the Ant Design context and break in React 19.

## Data Provider Filter Mapping

Filter field mapping is custom per resource in `data-provider.ts`. When adding a resource, map Refine filter fields to API query params explicitly:

```ts
// Refine filter { field: 'date', operator: 'gte', value: '2024-01-01' }
// → API query param: date_from=2024-01-01
```

## Form Persistence

Forms auto-save to localStorage on every change via `useEffect` and clear on successful submit. Storage key must be in `ST_KEYS` so `resetConfig()` clears it.

## Chart Tooltip Styling

Use the shared `TOOLTIP_STYLE` constant for dark-mode-compatible chart tooltips. Defined in `charts.tsx`.

## Dual-Axis Recharts

When using `yAxisId="left"` / `yAxisId="right"`, Recharts requires all referenced axis IDs to exist as `<YAxis>` elements — even if hidden. Use `<YAxis yAxisId="right" hide />` when the right axis has no data.

## 1RM Estimation

One canonical function in `utils.ts`: `estimate1RM(weight, reps)` — averages Epley, Brzycki, and Mayhew formulas. For computing full workout metrics (maxWeight, estimated1rm, totalVolume), use `computeWorkoutMetrics(sets, exercise)`. Never implement 1RM calculation inline.

## Exercise Labels

Use `exerciseLabel(key)` from `utils.ts` — never inline `EXERCISES.find(e => e.value === key)?.label`.
