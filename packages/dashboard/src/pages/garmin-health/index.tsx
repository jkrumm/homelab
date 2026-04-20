import { useList } from '@refinedev/core'
import { Col, Row, Select, Space, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { ActivityChart, BodyBatteryChart, FitnessChart, SleepChart, StressChart } from './charts'
import { ACWRThresholdChart, DivergenceThresholdChart, RecoveryThresholdChart } from './visx-charts'
import { DATE_PRESET_OPTIONS, getDateRange } from './constants'
import { HeroStats } from './stats'
import type { DailyMetric, DatePreset } from './types'

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

// ── Page ──────────────────────────────────────────────────────────────────

export default function GarminHealthPage() {
  const isMobile = useIsMobile()
  const [datePreset, setDatePreset] = useLocalState<DatePreset>('gh-date-preset', '30d')

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
        <Typography.Text strong style={{ fontSize: 16 }}>
          Garmin Health
        </Typography.Text>
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

      {/* Section 1: Fitness Progression */}
      {hasHeartData && (
        <>
          <SectionTitle title="Fitness Progression" />
          <FitnessChart data={metrics} />
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
                <SleepChart data={metrics} />
              </Col>
            )}
          </Row>
        </>
      )}

      {/* Section 4: Supporting Metrics */}
      {(hasBodyBattery || hasStressData || hasActivityData) && (
        <>
          <SectionTitle title="Supporting Metrics" />
          <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
            {hasBodyBattery && (
              <Col xs={24} lg={8}>
                <BodyBatteryChart data={metrics} />
              </Col>
            )}
            {hasStressData && (
              <Col xs={24} lg={8}>
                <StressChart data={metrics} />
              </Col>
            )}
            {hasActivityData && (
              <Col xs={24} lg={8}>
                <ActivityChart data={metrics} />
              </Col>
            )}
          </Row>
        </>
      )}
    </div>
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
