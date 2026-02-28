import { Elysia } from 'elysia'
import { saveTokens, initTickTickClient } from '../clients/ticktick'

const CALLBACK_URL = 'https://api.jkrumm.com/ticktick/auth/callback'
const AUTH_URL = 'https://ticktick.com/oauth/authorize'
const TOKEN_URL = 'https://ticktick.com/oauth/token'

export const ticktickAuthRoutes = new Elysia()
  .get(
    '/ticktick/auth/start',
    () => {
      const clientId = process.env.TICKTICK_CLIENT_ID
      if (!clientId) return new Response('TickTick client ID not configured', { status: 500 })
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: CALLBACK_URL,
        scope: 'tasks:read tasks:write',
      })
      return new Response(null, {
        status: 302,
        headers: { Location: `${AUTH_URL}?${params}` },
      })
    },
    {
      detail: {
        tags: ['TickTick Auth'],
        summary: 'Start OAuth2 flow (open in browser)',
        description:
          'Redirects to TickTick consent page. One-time setup only — run this from a browser on your Mac.',
      },
    },
  )
  .get(
    '/ticktick/auth/callback',
    async ({ query }) => {
      const code = query.code as string | undefined
      if (!code) return new Response('Missing authorization code', { status: 400 })

      const clientId = process.env.TICKTICK_CLIENT_ID!
      const clientSecret = process.env.TICKTICK_CLIENT_SECRET!
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          redirect_uri: CALLBACK_URL,
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        return new Response(`TickTick token exchange failed: ${body}`, { status: 502 })
      }

      const tokenData = await res.json()
      saveTokens(tokenData)
      initTickTickClient()

      return { ok: true, message: 'TickTick authenticated. Tokens saved.' }
    },
    {
      detail: {
        tags: ['TickTick Auth'],
        summary: 'OAuth2 callback — receives code, exchanges for tokens',
        description:
          'TickTick redirects here after consent. Exchanges code for access/refresh tokens and saves them to the volume.',
      },
    },
  )
