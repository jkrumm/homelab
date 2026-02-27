import { Cron } from 'croner'
import { pollVikunjaNotifications } from './vikunja-notifications'

export function registerCronJobs() {
  new Cron('*/10 * * * *', pollVikunjaNotifications)
}
