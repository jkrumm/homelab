import { treaty } from '@elysiajs/eden'
import type { App } from '@homelab/api'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://api.jkrumm.com'
const API_TOKEN = (import.meta.env.VITE_API_TOKEN as string | undefined) ?? ''

export const api = treaty<App>(API_URL, {
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
  },
})
