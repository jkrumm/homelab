import createClient from 'openapi-fetch'
import type { paths } from '../generated/vikunja'

export const vikunja = createClient<paths>({
  baseUrl: process.env.VIKUNJA_BASE_URL ?? 'https://vikunja.jkrumm.com',
  headers: { Authorization: `Bearer ${process.env.VIKUNJA_API_TOKEN}` },
})
