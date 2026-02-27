type Priority = 1 | 2 | 3 | 4 | 5

export async function publish(
  topic: string,
  title: string,
  message: string,
  priority: Priority = 3,
) {
  await fetch(
    `${process.env.NTFY_BASE_URL ?? 'https://ntfy.jkrumm.com'}/${topic}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NTFY_TOKEN}`,
        Title: title,
        Priority: String(priority),
        'Content-Type': 'text/plain',
      },
      body: message,
    },
  )
}
