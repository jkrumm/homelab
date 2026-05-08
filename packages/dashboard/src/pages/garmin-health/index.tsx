import { useInvalidate, useList } from '@refinedev/core'
import { App, Button, Col, Row, Select, Space, Tooltip, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HoverContext } from '../../charts'
import { api } from '../../providers/eden'
import {
  ACWRThresholdChart,
  ActivityBarChart,
  ActivityStackChart,
  BodyBatteryRangeChart,
  DivergenceThresholdChart,
  FitnessTrendChart,
  RecoveryThresholdChart,
  SleepBreakdownChart,
  StressLevelsChart,
} from './visx-charts'
import { DATE_PRESET_OPTIONS, getDateRange } from './constants'
import { HeroStats } from './stats'
import type { DailyMetric, DatePreset, GarminActivity } from './types'

// ── Hooks ─────────────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

function useLocalState<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue
    } catch {
      return defaultValue
    }
  })
  return [
    state,
    (value: T) => {
      setState(value)
      localStorage.setItem(key, JSON.stringify(value))
    },
  ]
}

// ── Garmin sync state ─────────────────────────────────────────────────────

type SyncStatus = {
  refresh_requested: boolean
  in_progress: boolean
  last_started_at: string | null
  last_completed_at: string | null
  last_status: string | null
  last_message: string | null
}

const STALE_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour
const POLL_INTERVAL_MS = 5000

function isStale(last_completed_at: string | null): boolean {
  if (!last_completed_at) return true
  const last = Date.parse(last_completed_at)
  if (Number.isNaN(last)) return true
  return Date.now() - last >= STALE_THRESHOLD_MS
}

function useGarminSync(onCompleted: () => void) {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const wasInProgress = useRef(false)
  const autoTriggered = useRef(false)

  const fetchStatus = useCallback(async (): Promise<SyncStatus | null> => {
    const { data, error } = await api['daily-metrics']['sync-status'].get()
    if (error) return null
    return data as SyncStatus
  }, [])

  const refresh = useCallback(async () => {
    setBusy(true)
    const { data, error } = await api['daily-metrics'].refresh.post()
    if (!error && data) setStatus(data as SyncStatus)
    setBusy(false)
  }, [])

  // Initial fetch + auto-refresh-if-stale on mount
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const s = await fetchStatus()
      if (cancelled) return
      setStatus(s)
      if (s && !s.in_progress && isStale(s.last_completed_at) && !autoTriggered.current) {
        autoTriggered.current = true
        await refresh()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fetchStatus, refresh])

  // Poll while a sync is queued or running
  useEffect(() => {
    if (!status) return
    const active = status.refresh_requested || status.in_progress
    if (!active) {
      // Edge: in_progress just flipped false → tell the page to refetch metrics
      if (wasInProgress.current) {
        wasInProgress.current = false
        onCompleted()
      }
      return
    }
    if (status.in_progress) wasInProgress.current = true

    const id = setInterval(() => {
      void (async () => {
        const s = await fetchStatus()
        if (s) setStatus(s)
      })()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [status, fetchStatus, onCompleted])

  return { status, busy, refresh }
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  const min = Math.round(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.round(hr / 24)
  return `${days}d ago`
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function GarminHealthPage() {
  const isMobile = useIsMobile()
  const { message } = App.useApp()
  const invalidate = useInvalidate()
  const [datePreset, setDatePreset] = useLocalState<DatePreset>('gh-date-preset', '30d')
  const [hover, setHoverState] = useState<{ date: string | null; source: string | null }>({
    date: null,
    source: null,
  })
  const setHover = useCallback(
    (date: string | null, source: string | null) => setHoverState({ date, source }),
    [],
  )
  const hoverCtx = useMemo(() => ({ ...hover, setHover }), [hover, setHover])

  const onSyncCompleted = useCallback(() => {
    void invalidate({ resource: 'daily-metrics', invalidates: ['list'] })
    message.success('Garmin data refreshed')
  }, [invalidate, message])
  const {
    status: syncStatus,
    busy: syncBusy,
    refresh: triggerRefresh,
  } = useGarminSync(onSyncCompleted)
  const syncing = Boolean(syncStatus?.in_progress || syncStatus?.refresh_requested || syncBusy)

  const [dateFrom, dateTo] = useMemo(() => getDateRange(datePreset), [datePreset])

  const { result, query } = useList<DailyMetric>({
    resource: 'daily-metrics',
    pagination: { currentPage: 1, pageSize: 10000 },
    sorters: [{ field: 'date', order: 'asc' }],
    filters: [
      { field: 'date', operator: 'gte', value: dateFrom },
      { field: 'date', operator: 'lte', value: dateTo },
    ],
  })

  const metrics = (result.data as DailyMetric[] | undefined) ?? []
  const isLoading = query.isLoading

  const { result: activitiesResult } = useList<GarminActivity>({
    resource: 'activities',
    pagination: { currentPage: 1, pageSize: 10000 },
    sorters: [{ field: 'date', order: 'asc' }],
    filters: [
      { field: 'date', operator: 'gte', value: dateFrom },
      { field: 'date', operator: 'lte', value: dateTo },
    ],
  })
  const activities = (activitiesResult.data as GarminActivity[] | undefined) ?? []
  const hasActivities = activities.length > 0

  const hasHeartData = metrics.some((m) => m.resting_hr !== null || m.hrv_last_night_avg !== null)
  const hasLoadData = metrics.some(
    (m) => m.moderate_intensity_min !== null || m.vigorous_intensity_min !== null,
  )
  const hasSleepData = metrics.some((m) => m.sleep_score !== null)
  const hasRecoveryData = metrics.some(
    (m) => m.sleep_score !== null || m.hrv_last_night_avg !== null,
  )
  const hasBodyBattery = metrics.some((m) => m.bb_highest !== null)
  const hasStressData = metrics.some((m) => m.avg_stress !== null)
  const hasActivityData = metrics.some((m) => m.steps !== null)

  return (
    <HoverContext.Provider value={hoverCtx}>
      <div style={{ padding: isMobile ? '12px 12px 80px' : '16px 24px 40px' }}>
        {/* Filter bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 16,
          }}
        >
          <Space size={8} align="center">
            <Typography.Text strong style={{ fontSize: 16 }}>
              Garmin Health
            </Typography.Text>
            <Tooltip
              title={
                syncing
                  ? 'Syncing Garmin Connect…'
                  : `Last sync: ${formatRelative(syncStatus?.last_completed_at ?? null)}${
                      syncStatus?.last_status === 'error' ? ' (error)' : ''
                    }`
              }
            >
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined spin={syncing} />}
                loading={false}
                disabled={syncing}
                onClick={() => void triggerRefresh()}
              >
                {syncing ? 'Syncing…' : formatRelative(syncStatus?.last_completed_at ?? null)}
              </Button>
            </Tooltip>
          </Space>
          <Space size={8}>
            <Select
              value={datePreset}
              onChange={setDatePreset}
              options={DATE_PRESET_OPTIONS}
              style={{ minWidth: 80 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {metrics.length} days
            </Typography.Text>
          </Space>
        </div>

        {/* Hero: 3 composite cards */}
        <HeroStats data={metrics} isLoading={isLoading} />

        {/* Recorded workouts — sits at the top above the daily-aggregate views */}
        {hasActivities && (
          <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
            <Col xs={24}>
              <ActivityStackChart
                activities={activities}
                dateFrom={dateFrom}
                dateTo={dateTo}
              />
            </Col>
          </Row>
        )}

        {/* Section 1: Effort & Adaptation */}
        {(hasActivityData || hasHeartData) && (
          <>
            <SectionTitle title="Activity & Fitness" />
            <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
              {hasActivityData && (
                <Col xs={24} lg={12}>
                  <ActivityBarChart data={metrics} />
                </Col>
              )}
              {hasHeartData && (
                <Col xs={24} lg={12}>
                  <FitnessTrendChart data={metrics} />
                </Col>
              )}
            </Row>
          </>
        )}

        {/* Section 2: Training Load */}
        {hasLoadData && (
          <>
            <SectionTitle title="Training Load" />
            <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
              <Col xs={24} lg={12}>
                <ACWRThresholdChart data={metrics} />
              </Col>
              <Col xs={24} lg={12}>
                <DivergenceThresholdChart data={metrics} />
              </Col>
            </Row>
          </>
        )}

        {/* Section 3: Recovery & Sleep */}
        {(hasRecoveryData || hasSleepData) && (
          <>
            <SectionTitle title="Recovery & Sleep" />
            <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
              {hasRecoveryData && (
                <Col xs={24} lg={12}>
                  <RecoveryThresholdChart data={metrics} />
                </Col>
              )}
              {hasSleepData && (
                <Col xs={24} lg={12}>
                  <SleepBreakdownChart data={metrics} />
                </Col>
              )}
            </Row>
          </>
        )}

        {/* Section 4: Body State */}
        {(hasBodyBattery || hasStressData) && (
          <>
            <SectionTitle title="Energy & Stress" />
            <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
              {hasBodyBattery && (
                <Col xs={24} lg={12}>
                  <BodyBatteryRangeChart data={metrics} />
                </Col>
              )}
              {hasStressData && (
                <Col xs={24} lg={12}>
                  <StressLevelsChart data={metrics} />
                </Col>
              )}
            </Row>
          </>
        )}
      </div>
    </HoverContext.Provider>
  )
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Typography.Text
      strong
      style={{ display: 'block', fontSize: 14, marginBottom: 8, marginTop: 8, opacity: 0.65 }}
    >
      {title}
    </Typography.Text>
  )
}
