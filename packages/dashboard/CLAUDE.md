# Dashboard — Refine v5 + Ant Design

Personal homelab dashboard built with Refine v5, React 19, Ant Design v5, Recharts, and Eden Treaty
for type-safe API calls.

**Refine docs:** https://context7.com/websites/refine_dev — use `/research` skill or WebFetch to query when unsure about Refine v5 APIs.

---

## Directory Structure

```
packages/dashboard/
├── src/
│   ├── main.tsx                     # Entry: React 19, strict mode, @ant-design/v5-patch-for-react-19
│   ├── App.tsx                      # Refine provider, router, theme toggle, sidebar layout
│   ├── providers/
│   │   ├── eden.ts                  # Eden Treaty client (bearer auth, env-based URL)
│   │   └── data-provider.ts         # Refine DataProvider backed by Eden Treaty
│   └── pages/
│       └── strength-tracker/
│           └── index.tsx            # Workout log form + Recharts charts (1RM trend, volume)
├── vite.config.ts                   # Vite 5, react plugin, strictPort 5173
├── tsconfig.json                    # Strict TS, bundler resolution, @homelab/api path alias
├── index.html
├── nginx.conf                       # Production serve config
└── Dockerfile                       # Multi-stage: bun build → nginx:alpine
```

---

## Adding a New Dashboard Page (End-to-End)

### 1. Define the Drizzle schema

In `packages/api/src/db/schema.ts`:

```ts
export const myTable = sqliteTable('my_table', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  created_at: text('created_at').default(sql`(datetime('now'))`),
})
```

Also add `CREATE TABLE IF NOT EXISTS` in `packages/api/src/db/index.ts` for zero-migration startup.

### 2. Create CRUD routes

Create `packages/api/src/routes/<resource>.ts`:

```ts
import { Elysia, t } from 'elysia'
import { db } from '../db/index.js'
import { myTable } from '../db/schema.js'

export const myRoutes = new Elysia({ prefix: '/my-resource' }).get(
  '/',
  async ({ query, set }) => {
    const start = Math.max(0, Number(query._start ?? 0))
    const end = Number(query._end ?? start + 20)
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(myTable)
    set.headers['x-total-count'] = String(count)
    return db
      .select()
      .from(myTable)
      .limit(end - start)
      .offset(start)
  },
  { query: t.Object({ _start: t.Optional(t.String()), _end: t.Optional(t.String()) }) },
)
// POST, PATCH, DELETE follow the same pattern as workouts.ts
```

See `packages/api/src/routes/workouts.ts` for the full pattern with sorting, filtering, and 201 responses.

### 3. Register routes in `packages/api/src/index.ts`

Add behind the auth guard (after `.use(authGuard)`):

```ts
import { myRoutes } from './routes/my-resource.js'
// ...
.use(myRoutes)
```

### 4. Extend the data provider

In `packages/dashboard/src/providers/data-provider.ts`, add cases for the new resource:

```ts
getList: async ({ resource, pagination, sorters, filters }) => {
  if (resource === 'my-resource') {
    const { data, error, response } = await api['my-resource'].get({ query })
    // ...
  }
}
```

### 5. Add Refine resource in `packages/dashboard/src/App.tsx`

```ts
resources={[
  { name: 'workouts', list: '/strength-tracker', meta: { label: 'Strength Tracker', icon: <TrophyOutlined /> } },
  { name: 'my-resource', list: '/my-page', meta: { label: 'My Page', icon: <SomeIcon /> } },
]}
```

### 6. Create the page

Create `packages/dashboard/src/pages/my-page/index.tsx` following the strength-tracker pattern:

```ts
import { useList } from '@refinedev/core'

export default function MyPage() {
  const { result, query } = useList({
    resource: 'my-resource',
    pagination: { currentPage: 1, pageSize: 100 },
  })
  const items = (result.data as MyType[] | undefined) ?? []
  // ...
}
```

### 7. Add route in `App.tsx`

```tsx
import MyPage from './pages/my-page'
// ...
;<Route path="/my-page" element={<MyPage />} />
```

---

## Data Provider Details

**Location:** `src/providers/data-provider.ts`

The custom DataProvider wraps Eden Treaty calls and maps Refine's interface to the API:

| Refine method | API call               | Query params                                       |
| ------------- | ---------------------- | -------------------------------------------------- |
| `getList`     | `GET /workouts`        | `_start`, `_end`, `_sort`, `_order`, filter fields |
| `getOne`      | `GET /workouts/:id`    | —                                                  |
| `create`      | `POST /workouts`       | body from `variables`                              |
| `update`      | `PATCH /workouts/:id`  | body from `variables`                              |
| `deleteOne`   | `DELETE /workouts/:id` | —                                                  |

Total count comes from the `x-total-count` response header (exposed via CORS).

To add a new resource, replicate the `if (resource === 'workouts')` branches for each method.

---

## Theme System

Dark/light mode is managed in `App.tsx` with `useState` + `localStorage` persistence:

```ts
// Read: ConfigProvider receives the algorithm
algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm

// Toggle: Header button calls toggleTheme()
localStorage.setItem('theme', next ? 'dark' : 'light')
```

In chart components, use CSS variables or hard-coded colors. The `EXERCISE_COLORS` record in
`strength-tracker/index.tsx` shows the pattern for per-series colors.

For chart grid lines that adapt to dark mode: `stroke="rgba(128,128,128,0.15)"` works in both themes.

---

## Chart Patterns

Recharts conventions used in this project:

```tsx
// Always wrap in ResponsiveContainer for responsive sizing
<ResponsiveContainer width="100%" height={220}>
  <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
    <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} />
    <YAxis tick={{ fontSize: 11 }} unit="kg" width={48} />
    <Tooltip formatter={(value, name) => [`${value} kg`, labelFor(name)]} />
    <Legend formatter={legendFormatter} />
    {series.map((key) => (
      <Line key={key} type="monotone" dataKey={key} stroke={COLORS[key]} dot={false} connectNulls />
    ))}
  </LineChart>
</ResponsiveContainer>
```

Data shape: flat objects `[{ date, bench_press: 120, deadlift: 180 }]` — use `buildChartData` in
strength-tracker as reference for transforming normalized records to Recharts format.

---

## Form Patterns

This project uses controlled React state instead of Ant Design Form (simpler for dynamic sets):

```tsx
const [items, setItems] = useState<Item[]>([defaultItem])

// Dynamic add/remove
const addItem = useCallback(() => setItems((prev) => [...prev, defaultItem]), [])
const removeItem = useCallback(
  (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i)),
  [],
)
const updateItem = useCallback(
  (i: number, field: keyof Item, value: Item[keyof Item]) =>
    setItems((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s))),
  [],
)
```

For simpler single-record forms, use Ant Design `Form` with `useCreate` / `useUpdate`.

Mutation pattern:

```ts
const { mutate, mutation } = useCreate()
mutate({ resource: 'workouts', values: { ... } }, {
  onSuccess: () => message.success('Saved!'),
  onError: err => message.error(String(err)),
})
```

Note: In Refine v5, `useCreate` returns `{ mutate, mutation }` (not `{ mutate, isLoading }`).
`mutation.isPending` is the loading flag.

---

## Mobile Responsiveness

The `useIsMobile()` hook (defined in strength-tracker) returns `window.innerWidth < 768` with a
resize listener. Use it to switch between mobile and desktop layouts:

```tsx
const isMobile = useIsMobile()
return isMobile ? <MobileLayout /> : <DesktopLayout />
```

For grid-based layouts, use Ant Design `Row` + `Col` with `xs`/`sm`/`md` breakpoints.

---

## Available Scripts

From `packages/dashboard/`:

```bash
bun run dev          # Vite dev server on port 5173 (strictPort)
bun run build        # tsc --noEmit && vite build (production)
bun run preview      # Preview production build
```

From repo root:

```bash
bun run lint         # oxlint — zero warnings/errors expected
bun run lint:fix     # oxlint --fix (auto-fixable rules)
bun run format       # oxfmt --write
bun run format:check # oxfmt --check
```

---

## Environment Variables

| Variable       | Default                  | Purpose      |
| -------------- | ------------------------ | ------------ |
| `VITE_API_URL` | `https://api.jkrumm.com` | API base URL |

Set in Docker: `--build-arg VITE_API_URL=<value>` or via `.env` for local dev.

---

## Important Notes

- `@ant-design/v5-patch-for-react-19` MUST be the first import in `main.tsx`
- `antd` is locked to v5 — do NOT upgrade to v6 (breaks `@refinedev/antd`)
- Refine v5 `useList` returns `{ result, query }` not `{ data, isLoading }` — see the v4→v5 breaking change
- Refine v5 pagination uses `currentPage` not `current`
- The Eden Treaty client is created once in `providers/eden.ts` — import `{ api }` from there
