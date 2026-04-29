import { io, type Socket } from 'socket.io-client'

const UPTIME_KUMA_URL = process.env.UPTIME_KUMA_URL ?? ''
const UPTIME_KUMA_USERNAME = process.env.UPTIME_KUMA_USERNAME ?? 'admin'
const UPTIME_KUMA_PASSWORD = process.env.UPTIME_KUMA_PASSWORD ?? ''

export interface UptimeMonitor {
  id: string
  name: string
  type: string
  url: string | null // null for docker, group, push monitors
  active: boolean
  status: number // 0=DOWN, 1=UP, 2=PENDING, 3=MAINTENANCE
  ping: number | null // ms; null for docker and push monitors
  uptime1d: number | null // ratio 0.0–1.0; null until first uptime event
  uptime30d: number | null // ratio 0.0–1.0; null until first uptime event
}

export type ClientStatus = 'warming' | 'ready' | 'stale'

export interface UptimeKumaSnapshot {
  status: ClientStatus
  lastUpdatedAt: string | null
  staleSince: string | null
  lastError: string | null
  monitors: UptimeMonitor[]
}

interface MonitorMeta {
  name: string
  type: string
  url: string | null
  active: boolean
}

interface MonitorRuntime {
  status: number
  ping: number | null
}

interface UptimeRatios {
  d1: number | null
  d30: number | null
}

interface RawMonitor {
  id: number
  name: string
  type: string
  url?: string
  active: boolean
}

interface RawHeartbeat {
  status: number
  ping: number | null
  time: string
}

interface RawHeartbeatLive {
  monitorID: number
  status: number
  ping: number | null
  time: string
}

interface LoginResponse {
  ok: boolean
  msg?: string
  token?: string
}

const STALE_AFTER_MS = 60_000
const PUBLIC_HEARTBEAT_INTERVAL_MS = 30_000
const RECONNECTION_DELAY_MS = 1_000
const RECONNECTION_DELAY_MAX_MS = 30_000

function normalizeUrl(raw: string | undefined): string | null {
  const v = raw ?? ''
  return v === '' || v === 'https://' ? null : v
}

class UptimeKumaClient {
  private socket: Socket | null = null
  private monitorMeta = new Map<string, MonitorMeta>()
  private monitorRuntime = new Map<string, MonitorRuntime>()
  private uptimeRatios = new Map<string, UptimeRatios>()
  private token: string | null = null

  private monitorListReceived = false
  private lastUpdatedAt: number | null = null
  private staleSince: number | null = null
  private lastError: string | null = null
  private connectionState:
    | 'idle'
    | 'connecting'
    | 'authenticating'
    | 'warming'
    | 'ready'
    | 'reconnecting'
    | 'stale' = 'idle'

  private heartbeatTimer: NodeJS.Timeout | null = null

  start(): void {
    if (this.socket) return
    if (!UPTIME_KUMA_URL) {
      // eslint-disable-next-line no-console
      console.warn('[uptime-kuma] UPTIME_KUMA_URL not set — client disabled')
      return
    }

    this.connectionState = 'connecting'
    this.socket = io(UPTIME_KUMA_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: RECONNECTION_DELAY_MS,
      reconnectionDelayMax: RECONNECTION_DELAY_MAX_MS,
      randomizationFactor: 0.5,
      timeout: 20_000,
    })

    this.bindListeners(this.socket)

    this.heartbeatTimer = setInterval(() => {
      if (this.connectionState === 'ready' && this.lastUpdatedAt !== null) {
        if (Date.now() - this.lastUpdatedAt > STALE_AFTER_MS) {
          this.connectionState = 'stale'
          this.staleSince = this.lastUpdatedAt
        }
      }
    }, PUBLIC_HEARTBEAT_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
    this.connectionState = 'idle'
  }

  getSnapshot(): UptimeKumaSnapshot {
    const status: ClientStatus =
      this.connectionState === 'ready' ? 'ready' : this.monitorListReceived ? 'stale' : 'warming'

    const monitors: UptimeMonitor[] = [...this.monitorMeta.entries()].map(([id, meta]) => {
      const runtime = this.monitorRuntime.get(id)
      const ratios = this.uptimeRatios.get(id)
      return {
        id,
        name: meta.name,
        type: meta.type,
        url: meta.url,
        active: meta.active,
        status: runtime?.status ?? 0,
        ping: runtime?.ping ?? null,
        uptime1d: ratios?.d1 ?? null,
        uptime30d: ratios?.d30 ?? null,
      }
    })

    return {
      status,
      lastUpdatedAt: this.lastUpdatedAt ? new Date(this.lastUpdatedAt).toISOString() : null,
      staleSince: this.staleSince ? new Date(this.staleSince).toISOString() : null,
      lastError: this.lastError,
      monitors,
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private touch(): void {
    this.lastUpdatedAt = Date.now()
    this.staleSince = null
    if (this.connectionState === 'stale') this.connectionState = 'ready'
  }

  private bindListeners(socket: Socket): void {
    socket.on('connect', () => {
      this.connectionState = 'authenticating'
      this.authenticate(socket)
    })

    socket.on('disconnect', (reason: string) => {
      this.connectionState = 'stale'
      this.staleSince = Date.now()
      this.lastError = `disconnected: ${reason}`
    })

    socket.on('connect_error', (err: Error) => {
      this.lastError = `connect_error: ${err.message}`
    })

    socket.io.on('reconnect_attempt', () => {
      this.connectionState = 'reconnecting'
    })

    // Kuma protocol events
    socket.on('loginRequired', () => {
      // Server cleared our session (e.g. server restart while we held an old token)
      this.connectionState = 'authenticating'
      this.authenticate(socket)
    })

    socket.on('monitorList', (data: Record<string, RawMonitor>) => {
      const next = new Map<string, MonitorMeta>()
      for (const [id, m] of Object.entries(data)) {
        next.set(id, {
          name: m.name,
          type: m.type,
          url: normalizeUrl(m.url),
          active: m.active,
        })
      }
      this.monitorMeta = next
      // Drop runtime/ratio entries for monitors that no longer exist
      for (const id of [...this.monitorRuntime.keys()]) {
        if (!next.has(id)) this.monitorRuntime.delete(id)
      }
      for (const id of [...this.uptimeRatios.keys()]) {
        if (!next.has(id)) this.uptimeRatios.delete(id)
      }
      this.monitorListReceived = true
      this.touch()
      if (this.connectionState === 'authenticating' || this.connectionState === 'warming') {
        this.connectionState = 'ready'
      }
    })

    socket.on('updateMonitorIntoList', (data: Record<string, RawMonitor>) => {
      for (const [id, m] of Object.entries(data)) {
        this.monitorMeta.set(id, {
          name: m.name,
          type: m.type,
          url: normalizeUrl(m.url),
          active: m.active,
        })
      }
      this.touch()
    })

    socket.on('deleteMonitorFromList', (monitorId: number) => {
      const id = String(monitorId)
      this.monitorMeta.delete(id)
      this.monitorRuntime.delete(id)
      this.uptimeRatios.delete(id)
      this.touch()
    })

    socket.on('heartbeatList', (monitorId: number, beats: RawHeartbeat[]) => {
      const last = beats.at(-1)
      if (!last) return
      this.monitorRuntime.set(String(monitorId), {
        status: last.status,
        ping: last.ping,
      })
      this.touch()
    })

    socket.on('heartbeat', (beat: RawHeartbeatLive) => {
      this.monitorRuntime.set(String(beat.monitorID), {
        status: beat.status,
        ping: beat.ping,
      })
      this.touch()
    })

    socket.on('uptime', (monitorId: number, type: number, value: number) => {
      const id = String(monitorId)
      const existing = this.uptimeRatios.get(id) ?? { d1: null, d30: null }
      // Kuma emits multiple windows; we surface 24h (1d) and 720h (30d).
      if (type === 24) existing.d1 = value
      else if (type === 720) existing.d30 = value
      else return
      this.uptimeRatios.set(id, existing)
      this.touch()
    })
  }

  private authenticate(socket: Socket): void {
    if (this.token) {
      socket.emit('loginByToken', this.token, (res: LoginResponse) => {
        if (res.ok) {
          this.connectionState = this.monitorListReceived ? 'ready' : 'warming'
          this.lastError = null
          return
        }
        // Token rejected (server restart or expiry) — fall back to user/pass
        this.token = null
        this.loginByCredentials(socket)
      })
      return
    }
    this.loginByCredentials(socket)
  }

  private loginByCredentials(socket: Socket): void {
    if (!UPTIME_KUMA_PASSWORD) {
      this.lastError = 'login: UPTIME_KUMA_PASSWORD not set'
      return
    }
    socket.emit(
      'login',
      { username: UPTIME_KUMA_USERNAME, password: UPTIME_KUMA_PASSWORD, token: '' },
      (res: LoginResponse) => {
        if (!res.ok) {
          this.lastError = `login failed: ${res.msg ?? 'unknown'}`
          return
        }
        if (res.token) this.token = res.token
        this.connectionState = this.monitorListReceived ? 'ready' : 'warming'
        this.lastError = null
      },
    )
  }
}

export const uptimeKumaClient = new UptimeKumaClient()
