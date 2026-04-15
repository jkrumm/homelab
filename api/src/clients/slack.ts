const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? ''
const SLACK_USER_TOKEN = process.env.SLACK_USER_TOKEN ?? ''

// ─── Slack Web API client ───────────────────────────────────────────────────

async function slackApi<T>(method: string, params?: Record<string, unknown>, token?: string): Promise<T> {
  const authToken = token ?? SLACK_BOT_TOKEN
  const isGet = !params || Object.keys(params).length === 0 ||
    Object.values(params).every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')

  if (isGet && (!params || !Object.values(params).some((v) => typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean'))) {
    const url = new URL(`https://slack.com/api/${method}`)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!res.ok) throw new Error(`Slack API ${method} HTTP ${res.status}`)
    const data = await res.json() as T & { ok: boolean; error?: string }
    if (!data.ok) throw new Error(`Slack API ${method}: ${data.error}`)
    return data
  }

  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`Slack API ${method} HTTP ${res.status}`)
  const data = await res.json() as T & { ok: boolean; error?: string }
  if (!data.ok) throw new Error(`Slack API ${method}: ${data.error}`)
  return data
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SlackChannel {
  id: string
  name: string
  is_channel: boolean
  is_group: boolean
  is_im: boolean
  is_mpim: boolean
  is_private: boolean
  is_archived: boolean
  topic: string
  purpose: string
  num_members: number
  updated: number
}

export interface SlackUser {
  id: string
  name: string
  real_name: string
  display_name: string
  is_bot: boolean
  is_app_user: boolean
  avatar: string
}

export interface SlackMessage {
  ts: string
  user: string
  text: string
  type: string
  thread_ts: string | null
  reply_count: number | null
  reply_users_count: number | null
  reactions: Array<{ name: string; count: number }> | null
  files: Array<{ name: string; mimetype: string; url_private: string }> | null
  edited: boolean
}

export interface SlackSearchResult {
  messages: SlackMessage[]
  total: number
  channel: string
  channel_name: string
}

// ─── Raw Slack API types ────────────────────────────────────────────────────

interface RawChannel {
  id: string
  name?: string
  name_normalized?: string
  is_channel?: boolean
  is_group?: boolean
  is_im?: boolean
  is_mpim?: boolean
  is_private?: boolean
  is_archived?: boolean
  topic?: { value?: string }
  purpose?: { value?: string }
  num_members?: number
  updated?: number
  user?: string // for DMs
}

interface RawMessage {
  ts: string
  user?: string
  bot_id?: string
  text?: string
  type?: string
  thread_ts?: string
  reply_count?: number
  reply_users_count?: number
  reactions?: Array<{ name: string; count: number; users: string[] }>
  files?: Array<{ name: string; mimetype: string; url_private: string }>
  edited?: { user: string; ts: string }
}

interface RawSearchMatch {
  ts: string
  user?: string
  text?: string
  type?: string
  thread_ts?: string
  channel?: { id: string; name: string }
}

// ─── Mappers ────────────────────────────────────────────────────────────────

function mapChannel(c: RawChannel, userMap?: Map<string, string>): SlackChannel {
  let name = c.name_normalized ?? c.name ?? c.id
  if (c.is_im && c.user && userMap?.has(c.user)) {
    name = `DM: ${userMap.get(c.user)}`
  }
  return {
    id: c.id,
    name,
    is_channel: c.is_channel ?? false,
    is_group: c.is_group ?? false,
    is_im: c.is_im ?? false,
    is_mpim: c.is_mpim ?? false,
    is_private: c.is_private ?? false,
    is_archived: c.is_archived ?? false,
    topic: c.topic?.value ?? '',
    purpose: c.purpose?.value ?? '',
    num_members: c.num_members ?? 0,
    updated: c.updated ?? 0,
  }
}

function mapMessage(m: RawMessage): SlackMessage {
  return {
    ts: m.ts,
    user: m.user ?? m.bot_id ?? '',
    text: m.text ?? '',
    type: m.type ?? 'message',
    thread_ts: m.thread_ts ?? null,
    reply_count: m.reply_count ?? null,
    reply_users_count: m.reply_users_count ?? null,
    reactions: m.reactions?.map((r) => ({ name: r.name, count: r.count })) ?? null,
    files: m.files?.map((f) => ({ name: f.name, mimetype: f.mimetype, url_private: f.url_private })) ?? null,
    edited: !!m.edited,
  }
}

// ─── User cache ─────────────────────────────────────────────────────────────

let userCache: Map<string, SlackUser> | null = null
let userCacheTime = 0
const USER_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getUserMap(): Promise<Map<string, SlackUser>> {
  if (userCache && Date.now() - userCacheTime < USER_CACHE_TTL) return userCache

  const users = new Map<string, SlackUser>()
  let cursor: string | undefined

  do {
    const res = await slackApi<{
      members: Array<{
        id: string
        name: string
        real_name?: string
        profile?: { display_name?: string; image_48?: string }
        is_bot?: boolean
        is_app_user?: boolean
      }>
      response_metadata?: { next_cursor?: string }
    }>('users.list', { limit: 200, ...(cursor ? { cursor } : {}) })

    for (const u of res.members) {
      users.set(u.id, {
        id: u.id,
        name: u.name,
        real_name: u.real_name ?? u.name,
        display_name: u.profile?.display_name ?? u.real_name ?? u.name,
        is_bot: u.is_bot ?? false,
        is_app_user: u.is_app_user ?? false,
        avatar: u.profile?.image_48 ?? '',
      })
    }
    cursor = res.response_metadata?.next_cursor || undefined
  } while (cursor)

  userCache = users
  userCacheTime = Date.now()
  return users
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function listChannels(opts: {
  types?: string
  exclude_archived?: boolean
  limit?: number
}): Promise<SlackChannel[]> {
  const types = opts.types ?? 'public_channel,private_channel,mpim,im'
  const channels: SlackChannel[] = []
  let cursor: string | undefined
  const userMap = await getUserMap().catch(() => new Map<string, SlackUser>())
  const userNameMap = new Map([...userMap.entries()].map(([id, u]) => [id, u.display_name || u.real_name]))

  do {
    const res = await slackApi<{
      channels: RawChannel[]
      response_metadata?: { next_cursor?: string }
    }>('conversations.list', {
      types,
      exclude_archived: opts.exclude_archived ?? true ? 'true' : 'false',
      limit: Math.min(opts.limit ?? 200, 1000),
      ...(cursor ? { cursor } : {}),
    })

    channels.push(...res.channels.map((c) => mapChannel(c, userNameMap)))
    cursor = res.response_metadata?.next_cursor || undefined
  } while (cursor && channels.length < (opts.limit ?? 500))

  return channels
}

async function autoJoin(channelId: string): Promise<void> {
  await slackApi('conversations.join', { channel: channelId }).catch(() => {})
}

export async function getMessages(channelId: string, opts: {
  limit?: number
  oldest?: string
  latest?: string
  cursor?: string
}): Promise<{ messages: SlackMessage[]; has_more: boolean; next_cursor: string | null }> {
  const params = {
    channel: channelId,
    limit: opts.limit ?? 50,
    ...(opts.oldest ? { oldest: opts.oldest } : {}),
    ...(opts.latest ? { latest: opts.latest } : {}),
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  }

  try {
    const res = await slackApi<{
      messages: RawMessage[]
      has_more: boolean
      response_metadata?: { next_cursor?: string }
    }>('conversations.history', params)

    return {
      messages: res.messages.map(mapMessage),
      has_more: res.has_more,
      next_cursor: res.response_metadata?.next_cursor ?? null,
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('not_in_channel')) {
      await autoJoin(channelId)
      const res = await slackApi<{
        messages: RawMessage[]
        has_more: boolean
        response_metadata?: { next_cursor?: string }
      }>('conversations.history', params)

      return {
        messages: res.messages.map(mapMessage),
        has_more: res.has_more,
        next_cursor: res.response_metadata?.next_cursor ?? null,
      }
    }
    throw e
  }
}

export async function getThread(channelId: string, threadTs: string, opts: {
  limit?: number
  cursor?: string
}): Promise<{ messages: SlackMessage[]; has_more: boolean; next_cursor: string | null }> {
  const res = await slackApi<{
    messages: RawMessage[]
    has_more: boolean
    response_metadata?: { next_cursor?: string }
  }>('conversations.replies', {
    channel: channelId,
    ts: threadTs,
    limit: opts.limit ?? 100,
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  })

  return {
    messages: res.messages.map(mapMessage),
    has_more: res.has_more,
    next_cursor: res.response_metadata?.next_cursor ?? null,
  }
}

export async function searchMessages(query: string, opts: {
  sort?: 'score' | 'timestamp'
  sort_dir?: 'asc' | 'desc'
  count?: number
  page?: number
}): Promise<{ matches: SlackSearchResult[]; total: number; page: number; pages: number }> {
  const res = await slackApi<{
    messages: {
      matches: RawSearchMatch[]
      total: number
      paging: { page: number; pages: number }
    }
  }>('search.messages', {
    query,
    sort: opts.sort ?? 'timestamp',
    sort_dir: opts.sort_dir ?? 'desc',
    count: opts.count ?? 20,
    page: opts.page ?? 1,
  }, SLACK_USER_TOKEN)

  const byChannel = new Map<string, { name: string; messages: SlackMessage[] }>()

  for (const m of res.messages.matches) {
    const chId = m.channel?.id ?? 'unknown'
    const chName = m.channel?.name ?? 'unknown'
    if (!byChannel.has(chId)) byChannel.set(chId, { name: chName, messages: [] })
    byChannel.get(chId)!.messages.push({
      ts: m.ts,
      user: m.user ?? '',
      text: m.text ?? '',
      type: m.type ?? 'message',
      thread_ts: m.thread_ts ?? null,
      reply_count: null,
      reply_users_count: null,
      reactions: null,
      files: null,
      edited: false,
    })
  }

  return {
    matches: [...byChannel.entries()].map(([id, { name, messages }]) => ({
      channel: id,
      channel_name: name,
      messages,
      total: messages.length,
    })),
    total: res.messages.total,
    page: res.messages.paging.page,
    pages: res.messages.paging.pages,
  }
}

export async function listUsers(): Promise<SlackUser[]> {
  const map = await getUserMap()
  return [...map.values()]
}

export async function sendMessage(channelId: string, text: string, opts?: {
  thread_ts?: string
  unfurl_links?: boolean
}): Promise<{ ts: string; channel: string }> {
  const res = await slackApi<{ ts: string; channel: string }>('chat.postMessage', {
    channel: channelId,
    text,
    ...(opts?.thread_ts ? { thread_ts: opts.thread_ts } : {}),
    unfurl_links: opts?.unfurl_links ?? true,
  })
  return { ts: res.ts, channel: res.channel }
}

export async function getUnreads(): Promise<Array<{
  channel_id: string
  channel_name: string
  unread_count: number
  latest_message: SlackMessage | null
}>> {
  // Get channels with unread counts
  const types = 'public_channel,private_channel,mpim,im'
  const unreads: Array<{
    channel_id: string
    channel_name: string
    unread_count: number
    latest_message: SlackMessage | null
  }> = []

  const userMap = await getUserMap()
  const userNameMap = new Map([...userMap.entries()].map(([id, u]) => [id, u.display_name || u.real_name]))
  let cursor: string | undefined

  do {
    const res = await slackApi<{
      channels: Array<RawChannel & { unread_count?: number; unread_count_display?: number }>
      response_metadata?: { next_cursor?: string }
    }>('conversations.list', {
      types,
      exclude_archived: 'true',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })

    for (const ch of res.channels) {
      const count = ch.unread_count_display ?? ch.unread_count ?? 0
      if (count > 0) {
        const mapped = mapChannel(ch, userNameMap)
        unreads.push({
          channel_id: ch.id,
          channel_name: mapped.name,
          unread_count: count,
          latest_message: null,
        })
      }
    }
    cursor = res.response_metadata?.next_cursor || undefined
  } while (cursor)

  // Fetch latest message for top 10 channels with most unreads
  unreads.sort((a, b) => b.unread_count - a.unread_count)
  const top = unreads.slice(0, 10)

  await Promise.all(
    top.map(async (u) => {
      try {
        const hist = await getMessages(u.channel_id, { limit: 1 })
        u.latest_message = hist.messages[0] ?? null
      } catch {
        // skip
      }
    }),
  )

  return unreads
}
