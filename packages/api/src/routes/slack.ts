import { Elysia, t } from 'elysia'
import {
  listChannels,
  getMessages,
  getThread,
  searchMessages,
  listUsers,
  sendMessage,
  getUnreads,
} from '../clients/slack.js'

// ─── Schemas ────────────────────────────────────────────────────────────────

const SlackChannelSchema = t.Object({
  id: t.String({ description: 'Slack channel ID (e.g. C01ABC123)' }),
  name: t.String({ description: 'Channel name or "DM: Display Name" for DMs' }),
  is_channel: t.Boolean(),
  is_group: t.Boolean(),
  is_im: t.Boolean({ description: 'Direct message' }),
  is_mpim: t.Boolean({ description: 'Multi-party direct message' }),
  is_private: t.Boolean(),
  is_archived: t.Boolean(),
  topic: t.String(),
  purpose: t.String(),
  num_members: t.Number(),
  updated: t.Number({ description: 'Unix timestamp of last activity' }),
})

const SlackUserSchema = t.Object({
  id: t.String({ description: 'Slack user ID (e.g. U01ABC123)' }),
  name: t.String({ description: 'Slack username' }),
  real_name: t.String(),
  display_name: t.String(),
  is_bot: t.Boolean(),
  is_app_user: t.Boolean(),
  avatar: t.String({ description: 'URL to 48x48 avatar image' }),
})

const FileSchema = t.Object({
  name: t.String(),
  mimetype: t.String(),
  url_private: t.String({ description: 'Authenticated URL to the file' }),
})

const ReactionSchema = t.Object({
  name: t.String({ description: 'Emoji name (without colons)' }),
  count: t.Number(),
})

const SlackMessageSchema = t.Object({
  ts: t.String({ description: 'Message timestamp (unique ID within channel)' }),
  user: t.String({ description: 'User ID or bot ID of the sender' }),
  text: t.String({ description: 'Message text (may contain Slack mrkdwn formatting)' }),
  type: t.String(),
  thread_ts: t.Union([t.String(), t.Null()], { description: 'Parent thread timestamp, null if not in a thread' }),
  reply_count: t.Union([t.Number(), t.Null()], { description: 'Number of replies if this is a thread parent' }),
  reply_users_count: t.Union([t.Number(), t.Null()], { description: 'Number of unique users in thread' }),
  reactions: t.Union([t.Array(ReactionSchema), t.Null()]),
  files: t.Union([t.Array(FileSchema), t.Null()]),
  edited: t.Boolean(),
})

const PaginatedMessagesSchema = t.Object({
  messages: t.Array(SlackMessageSchema),
  has_more: t.Boolean({ description: 'Whether more messages are available' }),
  next_cursor: t.Union([t.String(), t.Null()], { description: 'Cursor for next page, null if no more' }),
})

const SearchResultSchema = t.Object({
  matches: t.Array(
    t.Object({
      channel: t.String({ description: 'Channel ID' }),
      channel_name: t.String(),
      messages: t.Array(SlackMessageSchema),
      total: t.Number(),
    }),
  ),
  total: t.Number({ description: 'Total matches across all channels' }),
  page: t.Number(),
  pages: t.Number({ description: 'Total pages available' }),
})

const UnreadSchema = t.Object({
  channel_id: t.String(),
  channel_name: t.String(),
  unread_count: t.Number(),
  latest_message: t.Union([SlackMessageSchema, t.Null()], {
    description: 'Latest message (only for top 10 channels by unread count)',
  }),
})

const SendMessageBodySchema = t.Object({
  text: t.String({ description: 'Message text (supports Slack mrkdwn)' }),
  unfurl_links: t.Optional(t.Boolean({ description: 'Whether to unfurl URLs. Default: true' })),
})

const SendMessageResponseSchema = t.Object({
  ts: t.String({ description: 'Timestamp of the sent message' }),
  channel: t.String({ description: 'Channel the message was sent to' }),
})

// ─── Routes ─────────────────────────────────────────────────────────────────

export const slackRoutes = new Elysia({ prefix: '/slack' })

  // ── Channels ────────────────────────────────────────────────────────────

  .get(
    '/channels',
    async ({ query }) => {
      return listChannels({
        types: query.types,
        exclude_archived: query.exclude_archived !== 'false',
        limit: query.limit ? Number(query.limit) : undefined,
      })
    },
    {
      query: t.Object({
        types: t.Optional(
          t.String({
            description: 'Comma-separated: public_channel,private_channel,mpim,im. Default: all types',
          }),
        ),
        exclude_archived: t.Optional(t.String({ description: '"true" or "false". Default: true' })),
        limit: t.Optional(t.String({ description: 'Max channels to return. Default: 500' })),
      }),
      response: t.Array(SlackChannelSchema),
      detail: {
        tags: ['Slack'],
        summary: 'List all accessible channels, groups, DMs',
        description:
          'Returns all conversations the user has access to — public channels, private channels, group DMs, and direct messages. DMs show the other user\'s display name.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Messages ────────────────────────────────────────────────────────────

  .get(
    '/channels/:channelId/messages',
    async ({ params, query }) => {
      return getMessages(params.channelId, {
        limit: query.limit ? Number(query.limit) : undefined,
        oldest: query.oldest,
        latest: query.latest,
        cursor: query.cursor,
      })
    },
    {
      params: t.Object({
        channelId: t.String({ description: 'Slack channel ID' }),
      }),
      query: t.Object({
        limit: t.Optional(t.String({ description: 'Messages per page (max 100). Default: 50' })),
        oldest: t.Optional(t.String({ description: 'Unix timestamp — only messages after this' })),
        latest: t.Optional(t.String({ description: 'Unix timestamp — only messages before this' })),
        cursor: t.Optional(t.String({ description: 'Pagination cursor from previous response' })),
      }),
      response: PaginatedMessagesSchema,
      detail: {
        tags: ['Slack'],
        summary: 'Get message history for a channel',
        description:
          'Returns messages in reverse chronological order (newest first). Use oldest/latest for time ranges, cursor for pagination.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Thread ──────────────────────────────────────────────────────────────

  .get(
    '/channels/:channelId/messages/:threadTs/thread',
    async ({ params, query }) => {
      return getThread(params.channelId, params.threadTs, {
        limit: query.limit ? Number(query.limit) : undefined,
        cursor: query.cursor,
      })
    },
    {
      params: t.Object({
        channelId: t.String({ description: 'Slack channel ID' }),
        threadTs: t.String({ description: 'Thread parent message timestamp' }),
      }),
      query: t.Object({
        limit: t.Optional(t.String({ description: 'Messages per page (max 200). Default: 100' })),
        cursor: t.Optional(t.String({ description: 'Pagination cursor' })),
      }),
      response: PaginatedMessagesSchema,
      detail: {
        tags: ['Slack'],
        summary: 'Get all replies in a thread',
        description: 'Returns the parent message plus all replies in chronological order.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Search ──────────────────────────────────────────────────────────────

  .get(
    '/search',
    async ({ query }) => {
      return searchMessages(query.q, {
        sort: query.sort as 'score' | 'timestamp' | undefined,
        sort_dir: query.sort_dir as 'asc' | 'desc' | undefined,
        count: query.count ? Number(query.count) : undefined,
        page: query.page ? Number(query.page) : undefined,
      })
    },
    {
      query: t.Object({
        q: t.String({ description: 'Search query (supports Slack search syntax: in:#channel, from:@user, etc.)' }),
        sort: t.Optional(t.String({ description: '"score" or "timestamp". Default: timestamp' })),
        sort_dir: t.Optional(t.String({ description: '"asc" or "desc". Default: desc' })),
        count: t.Optional(t.String({ description: 'Results per page. Default: 20' })),
        page: t.Optional(t.String({ description: 'Page number (1-based). Default: 1' })),
      }),
      response: SearchResultSchema,
      detail: {
        tags: ['Slack'],
        summary: 'Search messages across all channels',
        description:
          'Full-text search across all accessible messages. Supports Slack search operators: in:#channel, from:@user, has:link, before:2024-01-01, after:2024-01-01, etc.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Users ───────────────────────────────────────────────────────────────

  .get(
    '/users',
    async () => {
      return listUsers()
    },
    {
      response: t.Array(SlackUserSchema),
      detail: {
        tags: ['Slack'],
        summary: 'List all workspace users',
        description: 'Returns all users in the workspace (cached for 5 minutes). Useful for resolving user IDs in messages to display names.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Unreads ─────────────────────────────────────────────────────────────

  .get(
    '/unreads',
    async () => {
      return getUnreads()
    },
    {
      response: t.Array(UnreadSchema),
      detail: {
        tags: ['Slack'],
        summary: 'Get channels with unread messages',
        description:
          'Returns all channels with unread messages, sorted by unread count descending. The latest message is included for the top 10 channels.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Send Message ────────────────────────────────────────────────────────

  .post(
    '/channels/:channelId/messages',
    async ({ params, body }) => {
      return sendMessage(params.channelId, body.text, {
        unfurl_links: body.unfurl_links,
      })
    },
    {
      params: t.Object({
        channelId: t.String({ description: 'Slack channel ID' }),
      }),
      body: SendMessageBodySchema,
      response: SendMessageResponseSchema,
      detail: {
        tags: ['Slack'],
        summary: 'Send a message to a channel',
        security: [{ BearerAuth: [] }],
      },
    },
  )

  // ── Reply to Thread ─────────────────────────────────────────────────────

  .post(
    '/channels/:channelId/messages/:threadTs/reply',
    async ({ params, body }) => {
      return sendMessage(params.channelId, body.text, {
        thread_ts: params.threadTs,
        unfurl_links: body.unfurl_links,
      })
    },
    {
      params: t.Object({
        channelId: t.String({ description: 'Slack channel ID' }),
        threadTs: t.String({ description: 'Thread parent message timestamp' }),
      }),
      body: SendMessageBodySchema,
      response: SendMessageResponseSchema,
      detail: {
        tags: ['Slack'],
        summary: 'Reply to a thread',
        description: 'Sends a message as a reply in the specified thread.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
