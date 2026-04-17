---
paths:
  - packages/dashboard/**
---

# Refine v5 + Ant Design + Eden Treaty

Rules and patterns for the homelab dashboard. This stack: Refine v5 + React 19 + Ant Design v5 +
Recharts + Eden Treaty.

---

## Refine v5 Core Hooks

### useList — BREAKING from v4

```ts
// v5 (current)
const { result, query } = useList<T>({
  resource: 'workouts',
  pagination: { currentPage: 1, pageSize: 100 }, // Note: currentPage, not current
  sorters: [{ field: 'date', order: 'asc' }],
  filters: [{ field: 'date', operator: 'gte', value: '2024-01-01' }],
})
const items = (result.data as T[] | undefined) ?? []
const isLoading = query.isLoading
```

### useCreate — BREAKING from v4

```ts
// v5 (current)
const { mutate, mutation } = useCreate()
// mutation.isPending (not isLoading)
mutate({ resource: 'workouts', values: { ... } }, {
  onSuccess: () => {},
  onError: (err) => {},
})
```

### Resources definition

```ts
{
  name: 'workouts',          // matches resource string in hooks
  list: '/strength-tracker', // route path
  meta: { label: 'Strength Tracker', icon: <TrophyOutlined /> },
}
```

---

## Ant Design v5 Integration

### Required import order in main.tsx

```ts
import '@ant-design/v5-patch-for-react-19' // MUST be first import
import '@refinedev/antd/dist/reset.css'
```

### Version pinning

- antd MUST stay v5 — v6 breaks @refinedev/antd (refinedev/refine#7140)
- ThemedLayout and ThemedSider (NOT ThemedLayoutV2/ThemedSiderV2 — that suffix does not exist)

### Sider render prop types require explicit annotation

```tsx
<ThemedSider
  render={({ items, collapsed }: { items: React.ReactNode; collapsed: boolean }) => <>{items}</>}
/>
```

---

## Eden Treaty Data Provider

### Client setup

```ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@homelab/api'
export const api = treaty<App>(API_URL)
```

Auth is handled server-side — Caddy injects the `Authorization` header when proxying to the API.

### Adding a new resource

In `data-provider.ts`, add cases dispatching on `resource` string for each method:

```ts
if (resource === 'my-resource') {
  const { data, error, response } = await api['my-resource'].get({ query })
  if (error) throw new Error(String(error.value))
  return {
    data: (data ?? []) as never[],
    total: Number(response.headers.get('x-total-count') ?? 0),
  }
}
```

### REST conventions (Refine simple-rest)

| Param    | Meaning               |
| -------- | --------------------- |
| `_start` | Offset (0-based)      |
| `_end`   | End index (exclusive) |
| `_sort`  | Sort field name       |
| `_order` | `asc` or `desc`       |

Response MUST include `x-total-count` header. CORS config needs `exposeHeaders: ['x-total-count']`.

---

## Recharts Patterns

```tsx
<ResponsiveContainer width="100%" height={220}>
  <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
    <YAxis tick={{ fontSize: 11 }} unit="kg" width={48} />
    <Tooltip formatter={(value, name) => [`${value} kg`, labelFor(name as string)]} />
    <Legend />
    {keys.map((key) => (
      <Line key={key} type="monotone" dataKey={key} stroke={COLORS[key]} dot={false} connectNulls />
    ))}
  </LineChart>
</ResponsiveContainer>
```

Grid line color `rgba(128,128,128,0.15)` works in both dark and light themes.

Data shape: flatten per-date aggregations — `[{ date, bench_press: 120, deadlift: 180 }]`.

---

## Common Pitfalls

### Refine v4 → v5 breaking changes

| v4                                          | v5                                         |
| ------------------------------------------- | ------------------------------------------ |
| `const { data, isLoading } = useList()`     | `const { result, query } = useList()`      |
| `pagination.current`                        | `pagination.currentPage`                   |
| `const { mutate, isLoading } = useCreate()` | `const { mutate, mutation } = useCreate()` |
| mutation `isLoading`                        | `mutation.isPending`                       |

### Elysia TypeBox `t` variable shadowing

The imported `t` from elysia shadows callback params named `t`. Use `task`, `item`, `row` instead.

### bun-types in dashboard tsconfig

The dashboard needs `"types": ["bun-types"]` + `bun-types` in devDependencies because the
`@homelab/api` path alias resolves `bun:sqlite` types at typecheck time.

---

## Mobile Layout Pattern

```tsx
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}
```
