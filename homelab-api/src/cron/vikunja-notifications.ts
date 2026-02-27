import { vikunja } from '../clients/vikunja'
import { publish } from '../clients/ntfy'

type NotifPayload = {
  task?: { title?: string }
  doer?: { name?: string; username?: string }
  comment?: { comment?: string }
}

export async function pollVikunjaNotifications(): Promise<void> {
  const { data, error } = await vikunja.GET('/notifications')
  if (error || !data) {
    console.error('[vikunja-notifications] fetch error:', error)
    return
  }

  // read_at not set = unread
  const unread = data.filter((n) => !n.read_at)
  if (unread.length === 0) return

  console.log(`[vikunja-notifications] forwarding ${unread.length} notification(s)`)

  for (const n of unread) {
    const payload = n.notification as NotifPayload | undefined
    const type = n.name ?? 'Notification'
    const taskTitle = payload?.task?.title
    const doer = payload?.doer?.name ?? payload?.doer?.username
    const commentText = payload?.comment?.comment?.slice(0, 200)

    const title = taskTitle ? `${type}: ${taskTitle}` : type
    const body = [doer && `By ${doer}`, commentText].filter(Boolean).join('\n') || type

    await publish('vikunja', title, body)
  }

  // Bulk mark all as read
  await vikunja.POST('/notifications', {})
  console.log('[vikunja-notifications] marked all as read')
}
