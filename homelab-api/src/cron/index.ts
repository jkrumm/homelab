import { Cron } from 'croner'

export function registerCronJobs() {
  new Cron('0 8 * * *', () => {
    // placeholder: daily 8 AM job
  })
}
