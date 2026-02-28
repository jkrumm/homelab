import { readFileSync } from 'fs'
import { createClient, createConfig } from '../generated/ticktick/client'
import {
  getAllProjects,
  getProjectWithDataById,
  createSingleTask,
  completeSpecifyTask,
  deleteSpecifyTask,
} from '../generated/ticktick/sdk.gen'
import type { Task } from '../generated/ticktick/types.gen'

const TOKENS_PATH = '/data/ticktick-tokens.json'
const TOKEN_URL = 'https://ticktick.com/oauth/token'

type TokenData = {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

let tokens: TokenData | null = null

function loadTokens(): TokenData {
  try {
    return JSON.parse(readFileSync(TOKENS_PATH, 'utf-8')) as TokenData
  } catch {
    throw new Error(
      `TickTick tokens not found at ${TOKENS_PATH}. Run the OAuth flow at /ticktick/auth/start`,
    )
  }
}

export function saveTokens(data: TokenData): void {
  tokens = data
  Bun.write(TOKENS_PATH, JSON.stringify(data, null, 2))
}

export async function refreshTokens(): Promise<void> {
  if (!tokens) tokens = loadTokens()

  const clientId = process.env.TICKTICK_CLIENT_ID!
  const clientSecret = process.env.TICKTICK_CLIENT_SECRET!
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
  }

  saveTokens((await res.json()) as TokenData)
}

export const ticktickClient = createClient(
  createConfig({ baseUrl: 'https://ticktick.com' }),
)

let interceptorsRegistered = false

function registerInterceptors(): void {
  if (interceptorsRegistered) return
  interceptorsRegistered = true

  // Inject Bearer token on every outgoing request
  ticktickClient.interceptors.request.use((request) => {
    if (tokens) request.headers.set('Authorization', `Bearer ${tokens.access_token}`)
    return request
  })

  // On 401: refresh tokens and retry once
  ticktickClient.interceptors.response.use(async (response, request) => {
    if (response.status === 401 && tokens) {
      try {
        await refreshTokens()
        const retried = request.clone()
        retried.headers.set('Authorization', `Bearer ${tokens!.access_token}`)
        return fetch(retried)
      } catch {
        return response
      }
    }
    return response
  })
}

export function initTickTickClient(): void {
  try {
    tokens = loadTokens()
    registerInterceptors()
    console.log('TickTick client initialized')
  } catch (err) {
    registerInterceptors() // still register so retries work after OAuth flow
    console.warn(`TickTick client not ready: ${(err as Error).message}`)
  }
}

// Named proxy operations — delegates to generated services using our configured client

export const ticktickOps = {
  getProjects: () => getAllProjects({ client: ticktickClient }),

  getProjectData: (projectId: string) =>
    getProjectWithDataById({ client: ticktickClient, path: { projectId } }),

  createTask: (body: Task) =>
    createSingleTask({ client: ticktickClient, body }),

  updateTask: async (taskId: string, body: Task): Promise<Response> => {
    if (!tokens) throw new Error('TickTick client not initialized')
    return fetch(`https://ticktick.com/open/v1/task/${taskId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  },

  completeTask: (projectId: string, taskId: string) =>
    completeSpecifyTask({ client: ticktickClient, path: { projectId, taskId } }),

  deleteTask: (projectId: string, taskId: string) =>
    deleteSpecifyTask({ client: ticktickClient, path: { projectId, taskId } }),
}
