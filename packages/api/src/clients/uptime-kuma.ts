import { io } from 'socket.io-client'

const UPTIME_KUMA_URL = process.env.UPTIME_KUMA_URL ?? ''
const UPTIME_KUMA_API_KEY = process.env.UPTIME_KUMA_API_KEY ?? ''
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
  uptime1d: number | null // ratio 0.0–1.0; null for push monitors
  uptime30d: number | null // ratio 0.0–1.0; null for push monitors
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

interface MonitorStatus {
  active: boolean
  status: number
  ping: number | null
}

// Fetches live status via Socket.IO — connect, login, collect monitorList + heartbeatList, disconnect
async function fetchViaSocketIO(): Promise<
  Map<string, { monitor: Pick<UptimeMonitor, 'name' | 'type' | 'url' | 'active'>; status: number; ping: number | null }>
> {
  return new Promise((resolve, reject) => {
    const socket = io(UPTIME_KUMA_URL, { transports: ['websocket'] })

    const monitorMeta = new Map<string, Pick<UptimeMonitor, 'name' | 'type' | 'url' | 'active'>>()
    const heartbeatMap = new Map<string, MonitorStatus>()
    const pendingIds = new Set<string>()
    let monitorListReceived = false
    let resolved = false

    function buildResult() {
      const result = new Map<
        string,
        { monitor: Pick<UptimeMonitor, 'name' | 'type' | 'url' | 'active'>; status: number; ping: number | null }
      >()
      for (const [id, meta] of monitorMeta) {
        const hb = heartbeatMap.get(id)
        result.set(id, { monitor: meta, status: hb?.status ?? 0, ping: hb?.ping ?? null })
      }
      return result
    }

    function tryResolve() {
      if (resolved || !monitorListReceived) return
      if (pendingIds.size === 0) {
        resolved = true
        clearTimeout(timer)
        socket.disconnect()
        resolve(buildResult())
      }
    }

    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      socket.disconnect()
      resolve(buildResult())
    }, 5000)

    socket.on('connect_error', (err) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      socket.disconnect()
      reject(new Error(`UptimeKuma Socket.IO connect error: ${err.message}`))
    })

    socket.on('connect', () => {
      socket.emit(
        'login',
        { username: UPTIME_KUMA_USERNAME, password: UPTIME_KUMA_PASSWORD, token: '' },
        (res: { ok: boolean; msg?: string }) => {
          if (!res.ok && !resolved) {
            resolved = true
            clearTimeout(timer)
            socket.disconnect()
            reject(new Error(`UptimeKuma login failed: ${res.msg ?? 'unknown'}`))
          }
        },
      )
    })

    socket.on('monitorList', (data: Record<string, RawMonitor>) => {
      for (const [id, m] of Object.entries(data)) {
        const rawUrl = m.url ?? ''
        const url = rawUrl === '' || rawUrl === 'https://' ? null : rawUrl
        monitorMeta.set(id, { name: m.name, type: m.type, url, active: m.active })
        pendingIds.add(id)
      }
      monitorListReceived = true
      tryResolve()
    })

    socket.on('heartbeatList', (monitorId: number, beats: RawHeartbeat[], _overwrite: boolean) => {
      const id = String(monitorId)
      const last = beats.at(-1)
      heartbeatMap.set(id, { active: true, status: last?.status ?? 0, ping: last?.ping ?? null })
      pendingIds.delete(id)
      tryResolve()
    })
  })
}

// Fetches uptime ratios from Prometheus endpoint (1d + 30d per monitor)
async function fetchUptimeRatios(): Promise<Map<string, { d1: number | null; d30: number | null }>> {
  const credentials = Buffer.from(`:${UPTIME_KUMA_API_KEY}`).toString('base64')
  const base = UPTIME_KUMA_URL.replace(/\/$/, '')
  const res = await fetch(`${base}/metrics`, {
    headers: { Authorization: `Basic ${credentials}` },
  })
  if (!res.ok) throw new Error(`UptimeKuma metrics ${res.status}: ${await res.text()}`)
  const text = await res.text()

  const map = new Map<string, { d1: number | null; d30: number | null }>()
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    const m = line.match(/^monitor_uptime_ratio\{monitor_id="([^"]+)"[^}]*,window="([^"]+)"\}\s+([\d.]+)/)
    if (!m) continue
    const [, id, window, val] = m
    if (!map.has(id)) map.set(id, { d1: null, d30: null })
    const entry = map.get(id)!
    if (window === '1d') entry.d1 = Number(val)
    if (window === '30d') entry.d30 = Number(val)
  }
  return map
}

export async function fetchMonitors(): Promise<UptimeMonitor[]> {
  const [socketData, ratios] = await Promise.all([
    fetchViaSocketIO(),
    fetchUptimeRatios().catch(() => new Map<string, { d1: number | null; d30: number | null }>()),
  ])

  return [...socketData.entries()].map(([id, { monitor, status, ping }]) => ({
    id,
    name: monitor.name,
    type: monitor.type,
    url: monitor.url,
    active: monitor.active,
    status,
    ping,
    uptime1d: ratios.get(id)?.d1 ?? null,
    uptime30d: ratios.get(id)?.d30 ?? null,
  }))
}
