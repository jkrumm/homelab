# Group 3: Dashboard Scaffold + Deployment

## What You're Doing

Create the Refine v5 dashboard app in `packages/dashboard/`, set up Ant Design with dark/light theme switching, build the sidebar navigation shell, and wire up Docker + Caddy deployment. After this group, the dashboard container starts, Caddy routes to it, and you see a working app shell with sidebar navigation and theme toggle — but no data connection yet.

---

## Research & Exploration First

1. Read `packages/dashboard/package.json` — the placeholder from Group 1 (if it exists)
2. Read `docker-compose.yml` — understand service patterns, networks, labels
3. Read `Caddyfile` — understand site block patterns for private (Tailscale-only) services
4. Research **Refine v5** setup:
   - Latest package versions: `@refinedev/core`, `@refinedev/antd`, `@refinedev/react-router`
   - How to set up with Vite + React 19 (check compatibility — React 19 support confirmed in v5)
   - App component structure: `<Refine>` wrapper, resources, routes
   - Sidebar/Sider layout with Ant Design
5. Research **Ant Design v5** theme configuration:
   - `ConfigProvider` with `algorithm` for dark/light
   - System preference detection (`prefers-color-scheme` media query)
   - How to persist theme choice (localStorage)
6. Research **Vite** setup for React 19 — any specific plugins needed?
7. Check latest nginx:alpine Docker image best practices for SPAs (try_files, fallback to index.html)

---

## What to Implement

### 1. Vite + React 19 project (`packages/dashboard/`)

- `package.json` with all dependencies:
  - `react`, `react-dom` (v19)
  - `@refinedev/core`, `@refinedev/antd`, `@refinedev/react-router`
  - `antd` (v5)
  - `recharts`
  - `@ant-design/icons`
  - `vite`, `@vitejs/plugin-react`
  - TypeScript deps
- `vite.config.ts` — React plugin, port 5173, proxy to API in dev (optional)
- `tsconfig.json` — strict mode, React JSX, path aliases if useful
- `index.html` — minimal entry point

### 2. App shell (`packages/dashboard/src/`)

- `main.tsx` — React root render
- `App.tsx` — Refine app with:
  - `<Refine>` wrapper with resources configuration
  - React Router integration
  - Placeholder data provider (will be replaced by Eden Treaty in Group 4)
  - Ant Design `<ConfigProvider>` with theme support
- Theme context/provider:
  - Detect system preference on mount
  - Manual toggle button in the header/top bar
  - Persist choice to localStorage
  - Switch between `theme.defaultAlgorithm` and `theme.darkAlgorithm`

### 3. Layout & Navigation

- Ant Design `Layout` with `Sider` (collapsible sidebar)
- Navigation items:
  - **Strength Tracker** — active, links to `/strength-tracker`
  - **Docker** — disabled/coming-soon style
  - **Monitoring** — disabled/coming-soon style
  - **Tasks** — disabled/coming-soon style
- Strength tracker page: just a placeholder `<div>Strength Tracker — coming in Group 4</div>`
- Header with theme toggle button (sun/moon icon)
- Responsive: sidebar collapses to hamburger on mobile

### 4. Docker deployment

- `packages/dashboard/Dockerfile`:

  ```
  # Stage 1: Build
  FROM oven/bun:1-alpine AS build
  WORKDIR /app
  COPY package.json bun.lock ./
  # Copy workspace root package.json for resolution
  COPY ../../package.json /workspace/package.json
  RUN bun install --frozen-lockfile
  COPY . .
  RUN bun run build

  # Stage 2: Serve
  FROM nginx:alpine
  COPY --from=build /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80
  ```

  Note: the exact Dockerfile may need adjustment for monorepo context. Research best practices for building a monorepo package in Docker. You may need to COPY the root package.json and bun.lock for workspace resolution, or use a simpler approach.

- `packages/dashboard/nginx.conf`:

  ```nginx
  server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    location / {
      try_files $uri $uri/ /index.html;
    }
  }
  ```

- Add to `docker-compose.yml`:
  ```yaml
  dashboard:
    build: ./packages/dashboard
    container_name: dashboard
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 128M
    labels:
      glance.url: https://dashboard.jkrumm.com
      com.centurylinklabs.watchtower.enable: 'false'
  ```

### 5. Caddy route

Add a site block for `dashboard.jkrumm.com` in `Caddyfile`. Follow the pattern of other private (Tailscale-only) services — HTTPS with DNS-01 challenge, no `http://` cloudflared variant. Look at how `beszel.jkrumm.com` or `dozzle.jkrumm.com` are configured.

---

## Validation

```bash
# Typecheck
cd packages/dashboard && bun tsc --noEmit

# Build
cd packages/dashboard && bun run build
# Should produce dist/ with index.html + JS/CSS bundles

# Docker build (if Docker is available locally)
# docker build -t dashboard-test packages/dashboard
# docker run --rm -p 8085:80 dashboard-test
# curl -s http://localhost:8085 | head -5
```

Verify:

- `bun install` from root resolves both workspaces
- Vite dev server starts (`bun run dev` in packages/dashboard)
- Production build succeeds
- App renders with Ant Design sidebar layout
- Theme toggle switches between light and dark
- Sidebar shows navigation items (Strength Tracker active, others disabled)
- Mobile: sidebar collapses

---

## Commit

```
feat(dashboard): scaffold Refine v5 app with Ant Design, theme switching, and sidebar navigation

feat(infra): add dashboard container and Caddy route
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 3
```
