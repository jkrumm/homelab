import { Elysia, t } from 'elysia'
import { getAuthUrl, exchangeCode } from '../clients/google.js'

export const oauthRoutes = new Elysia({ prefix: '/oauth' })
  .get('/google/init', ({ redirect }) => redirect(getAuthUrl()), {
    detail: {
      tags: ['OAuth'],
      summary: 'Initiate Google OAuth',
      description:
        'Redirects browser to Google consent screen. Visit in a browser to grant Gmail and Calendar read access. No auth required.',
      security: [],
    },
  })
  .get(
    '/google/callback',
    async ({ query, set }) => {
      if (query.error) {
        set.status = 400
        return `OAuth error: ${query.error}`
      }
      if (!query.code) {
        set.status = 400
        return 'Missing code parameter'
      }
      try {
        await exchangeCode(query.code)
        return 'Google OAuth successful — tokens saved. You can close this tab.'
      } catch (error) {
        set.status = 500
        return error instanceof Error ? error.message : 'Token exchange failed'
      }
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        error: t.Optional(t.String()),
        scope: t.Optional(t.String()),
      }),
      response: { 200: t.String(), 400: t.String(), 500: t.String() },
      detail: {
        tags: ['OAuth'],
        summary: 'Google OAuth callback',
        description:
          'Exchanges authorization code for access + refresh tokens and saves them to disk. Called automatically by Google after user consent. No auth required.',
        security: [],
      },
    },
  )
