# PRD: Gmail & Google Calendar API Integration

## Problem

The homelab API has no access to personal communication data. The Hermes AI agent needs to query Gmail and Google Calendar to provide context-aware assistance. Microsoft/Outlook integration is blocked by IU org policies (Okta-federated account with no Azure AD identity, calendar sharing disabled) — out of scope for v1.

## Goals

- Add Gmail email listing + full body fetch to the API
- Add Google Calendar event listing (all personal calendars)
- OAuth init/callback endpoints for one-time token setup (headless server flow)
- Fully typed Elysia routes with LLM-friendly OpenAPI descriptions
- Live responses (no caching in v1)

## Non-Goals

- Microsoft/Outlook integration — blocked by IU org policies, revisit later via n8n
- No unified abstraction across sources
- No integration into `/summary` (that's infra-only)
- No webhook/push notifications — poll only
- No email sending or calendar mutations
- No Gmail label management
- No caching layer (v1 — add later if latency is a problem)

## Routes

```
GET /oauth/google/init           → redirect to Google consent screen (browser only)
GET /oauth/google/callback       → exchange code, save tokens to disk

GET /gmail/emails                → list emails (query, days, maxResults params)
GET /gmail/emails/:id            → full email with decoded body
GET /gmail/calendar              → upcoming events (days param, default 30, all calendars)
```

## Query Parameters

**Email list endpoints:**
- `days` — how many days back to search (default: 7)
- `maxResults` — max emails returned (default: 50)
- `query` — free-text search string passed to Gmail query / OData $filter

**Calendar endpoints:**
- `days` — window from today (default: 30 for Google, 10 for Outlook)

## Filtering Defaults

**Gmail:**
- Label filter: `in:inbox -category:spam -category:promotions -category:social`
- Sorted by date descending

**Outlook:**
- Focused inbox preferred if available, else all non-junk mail
- Sorted by receivedDateTime descending

## Email Response Shape (list item)

```ts
{
  id: string
  subject: string
  from: { name: string; email: string }
  to: Array<{ name: string; email: string }>
  date: string           // ISO timestamp
  snippet: string        // 200-char preview
  isRead: boolean
  labels?: string[]      // Gmail only
  hasAttachments: boolean
}
```

## Email Response Shape (detail — :id)

Same as above plus:
```ts
{
  body: string           // plaintext preferred, HTML fallback stripped to text
  attachments: Array<{ filename: string; mimeType: string; size: number }>
}
```

## Calendar Event Shape

```ts
{
  id: string
  title: string
  start: string          // ISO timestamp
  end: string            // ISO timestamp
  isAllDay: boolean
  location?: string
  organizer?: { name: string; email: string }
  attendees: Array<{ name: string; email: string; status: string }>
  calendarName: string   // which calendar this belongs to
  videoLink?: string     // extracted Google Meet / Teams link
}
```

## Token Storage

- Path: `/home/jkrumm/homelab/api/data/oauth-tokens.json`
- Structure: `{ google: { accessToken, refreshToken, expiresAt }, microsoft: { ... } }`
- File created on first successful OAuth callback
- Access token refreshed automatically when expired (before each API call)
- File must be in `.gitignore` — never committed

## App Registrations Required (manual prerequisite)

**Google Cloud Console:**
- Enable: Gmail API, Google Calendar API
- OAuth 2.0 scopes: `gmail.readonly`, `calendar.readonly`
- Redirect URI: `https://api.jkrumm.com/oauth/google/callback`
- Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

**Microsoft:** Out of scope for v1 — IU Okta-federated account blocks all registration paths and calendar sharing. Revisit via n8n self-hosted middleware.

## Success Criteria

- OAuth flow works end-to-end in browser, tokens saved to disk
- `/gmail/emails` returns typed list with correct default filters applied
- `/gmail/emails/:id` returns decoded plaintext body
- `/gmail/calendar` returns all personal calendars merged, next 30 days
- Same for Outlook equivalents
- All routes have OpenAPI `summary`, `description`, and `tags` for LLM consumption
- TypeScript strict — no `any`, full response schemas via Elysia `t.*`
- Expired tokens are refreshed transparently without manual intervention
