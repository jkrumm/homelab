# Homelab Dashboard — RALPH Shared Context

You are implementing a **Refine v5 dashboard** for a personal homelab API, restructured as a Bun monorepo with end-to-end type safety via Eden Treaty. Read this fully before starting your group.

---

## What This Project Is

A personal homelab infrastructure managed via Docker Compose on an Ubuntu Server. The `homelab-api` (Elysia/Bun on port 4000) is a stateless integration hub — it proxies TickTick, Slack, Gmail, UptimeKuma, Docker, and weather data behind a bearer-token auth wall. It has Swagger/OpenAPI docs at `/docs`.

We're adding two things:

1. **SQLite database** (via Drizzle ORM) to the API for storing custom data (starting with workout tracking)
2. **Refine v5 dashboard** (Vite + React 19 + Ant Design + Recharts) as a separate container, consuming the API via Eden Treaty for full type safety

The whole thing is restructured into a **Bun monorepo** (`packages/api` + `packages/dashboard`) so the dashboard can import API types at build time.

This is a personal tool — Tailscale-only, no public users, no auth beyond the existing bearer token. Optimize for LLM-assisted rapid development (vibe coding). The dashboard will grow over time with new pages (Docker monitoring, TickTick boards, etc.) — the first page is a workout/strength tracker.

---

## Repository Layout (Current → Target)

**Current:**

```
homelab/
├── api/                     # Elysia API (port 4000)
│   ├── src/
│   │   ├── index.ts         # Main app — Elysia + Swagger + bearer auth
│   │   ├── routes/          # 9 route files (docker, gmail, health, oauth, slack, summary, ticktick, uptime-kuma, weather)
│   │   ├── clients/         # External API clients (google, slack, ticktick, uptime-kuma)
│   │   ├── generated/       # Auto-generated TickTick SDK
│   │   └── cron/index.ts    # Empty cron registration
│   ├── Dockerfile           # Alpine + Bun
│   ├── package.json
│   └── data/                # OAuth tokens (gitignored, volume-mounted)
├── docker-compose.yml       # 28 containers
├── Caddyfile                # Reverse proxy (public + private routes)
├── .env.tpl                 # 1Password op:// references
└── ...
```

**Target (after all groups):**

```
homelab/
├── package.json             # Bun workspace root
├── packages/
│   ├── api/                 # Elysia API (moved from api/)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── db/          # NEW: Drizzle schema, connection, migrations
│   │   │   ├── routes/      # Existing + new CRUD routes (workouts, workout-sets, query)
│   │   │   ├── clients/
│   │   │   ├── generated/
│   │   │   └── cron/
│   │   ├── Dockerfile
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   └── dashboard/           # NEW: Refine v5 app
│       ├── src/
│       │   ├── App.tsx
│       │   ├── providers/   # Refine data provider (Eden Treaty)
│       │   ├── pages/       # Dashboard pages (strength-tracker, etc.)
│       │   └── components/  # Shared chart/form components
│       ├── Dockerfile       # Multi-stage: bun build → nginx
│       ├── nginx.conf
│       └── package.json
├── docker-compose.yml       # Updated: api build context + new dashboard service
├── Caddyfile                # Updated: dashboard.jkrumm.com route
└── .env.tpl
```

---

## Tech Stack

| Concern            | Choice                                                 |
| ------------------ | ------------------------------------------------------ |
| Runtime            | Bun (monorepo workspaces)                              |
| API framework      | Elysia v1.4+ (existing)                                |
| Database           | SQLite via bun:sqlite                                  |
| ORM                | Drizzle ORM (schema-as-code, migrations)               |
| Frontend framework | React 19 + Vite                                        |
| UI framework       | Refine v5 + Ant Design v5                              |
| Charts             | Recharts                                               |
| API client         | Eden Treaty (Elysia type-safe client)                  |
| Linting            | oxlint                                                 |
| Formatting         | oxfmt                                                  |
| Auth               | Bearer token (existing API_SECRET env var)             |
| Deployment         | Docker Compose (nginx for dashboard, Bun for API)      |
| Reverse proxy      | Caddy (HTTPS via DNS-01, Tailscale-only for dashboard) |

---

## Key Files to Read Before Modifying

- `docker-compose.yml` — the API service definition (lines ~525-558), network topology
- `Caddyfile` — routing rules, site blocks for private services
- `packages/api/src/index.ts` — main Elysia app, auth guard, plugin registration
- `packages/api/src/routes/*.ts` — existing route patterns (use as reference for new routes)
- `.env.tpl` — secret references (API_SECRET is the bearer token)
- `CLAUDE.md` — project conventions, SSH patterns, deployment workflow

---

## Validation Commands

**Primary (run after every group where applicable):**

```bash
# From repo root
bun install                                    # workspace resolution
cd packages/api && bun tsc --noEmit            # API typecheck
```

**After Group 3+ (dashboard exists):**

```bash
cd packages/dashboard && bun run build         # Vite production build
```

**After Group 5 (linting set up):**

```bash
bun lint                                       # oxlint
bun format:check                               # oxfmt --check
```

**Note:** No test suite exists yet. Validation is typecheck + build. Don't add tests unless a group prompt explicitly asks for them.

---

## Deployment Pattern

This repo is edited locally, pushed to GitHub, then pulled and applied on the server:

```bash
# Local: commit + push
git push

# Server: pull + rebuild
ssh homelab "cd ~/homelab && git pull && op run --env-file=.env.tpl -- docker compose up -d --build api dashboard"
```

You do NOT deploy during RALPH. Just commit. Deployment happens after all groups.

---

## API Authentication

All endpoints except `/health` and `/oauth/*` require a bearer token:

```
Authorization: Bearer <API_SECRET>
```

The dashboard will pass this token via Eden Treaty / data provider config. For local development, the token value comes from `op read "op://homelab/api/API_SECRET" --account tkrumm`.

---

## PRD Reference

The full PRD is at `PRD.md` in the repo root. Read it for detailed data model, page layouts, REST conventions, and success criteria.

---

## Research Before Implementing

Always start each group by:

1. **Explore** the codebase with Glob/Grep/Read — understand existing patterns before writing
2. **Research** unfamiliar libraries: use WebSearch + WebFetch to check current docs, especially for Refine v5, Eden Treaty, Drizzle, and Recharts
3. **Read existing code** before modifying — never edit a file you haven't read
4. The group prompt is direction, not prescription — if you find a better approach during research, use it
5. Check npm for latest stable versions — don't assume versions from training data

---

## Learning Notes

After completing each group, **always append** to `docs/ralph/RALPH_NOTES.md`:

```markdown
## Group N: <title>

### What was implemented

<1–3 sentences>

### Deviations from prompt

<what you changed and why>

### Gotchas & surprises

<anything unexpected — library APIs, language quirks, tooling surprises>

### Future improvements

<deferred work, tech debt, better approaches possible>
```

---

## Commit Format

Conventional commits, no AI attribution:

```
feat(<scope>): <description>
refactor(<scope>): <description>
fix(<scope>): <description>
```

Stage only modified files. Commit before signaling completion. Use scope `api`, `dashboard`, `infra`, or `monorepo` as appropriate.

---

## Completion Signal

Output exactly one of these at the end, as the very last line:

```
RALPH_TASK_COMPLETE: Group N
```

If you cannot proceed due to an unresolvable blocker:

```
RALPH_TASK_BLOCKED: Group N - <reason in one sentence>
```
