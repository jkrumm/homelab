import { Cron } from 'croner'
import { refreshTokens } from '../clients/ticktick'

export function registerCronJobs() {
  // Proactively refresh TickTick tokens weekly (access tokens expire in 30 days)
  new Cron('0 3 * * 1', async () => {
    console.log('[cron] Refreshing TickTick tokens')
    try {
      await refreshTokens()
      console.log('[cron] TickTick tokens refreshed')
    } catch (err) {
      console.error('[cron] TickTick token refresh failed:', err)
    }
  })
}
