import { treaty } from '@elysiajs/eden'
import type { App } from '@homelab/api'

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://api.jkrumm.com'

export const api = treaty<App>(API_URL)
