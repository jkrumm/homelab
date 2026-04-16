import { useList } from '@refinedev/core'
import { Button, Col, DatePicker, Row, Space, Switch, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AreaMetricChart, FrequencyChart, MainChart } from './charts'
import { DEFAULT_DATE_FROM, DEFAULT_DATE_TO, EXERCISE_COLORS, EXERCISES } from './constants'
import { generateDemoWorkouts } from './demo-data'
import { SummaryStats } from './stats'
import type { ExerciseKey, Workout } from './types'
import { WorkoutForm } from './workout-form'

// ── Responsive hook ────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function StrengthTrackerPage() {
  const isMobile = useIsMobile()

  const [activeExercises, setActiveExercises] = useState<ExerciseKey[]>([
    'bench_press',
    'deadlift',
    'squat',
    'pull_ups',
  ])
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM)
  const [dateTo, setDateTo] = useState(DEFAULT_DATE_TO)
  const [useDemoData, setUseDemoData] = useState(false)

  const toggleExercise = useCallback((ex: ExerciseKey) => {
    setActiveExercises((prev) => (prev.includes(ex) ? prev.filter((e) => e !== ex) : [...prev, ex]))
  }, [])

  const { result, query } = useList<Workout>({
    resource: 'workouts',
    pagination: { currentPage: 1, pageSize: 500 },
    sorters: [{ field: 'date', order: 'asc' }],
    filters: [
      { field: 'date', operator: 'gte', value: dateFrom },
      { field: 'date', operator: 'lte', value: dateTo },
    ],
  })

  const workouts = (result.data as Workout[] | undefined) ?? []
  const isLoading = query.isLoading

  const demoWorkouts = useMemo(() => (useDemoData ? generateDemoWorkouts() : []), [useDemoData])
  const displayWorkouts = useDemoData ? demoWorkouts : workouts

  const filterBar = (
    <Row gutter={[12, 8]} style={{ marginBottom: 16 }} align="middle">
      <Col xs={24} md={12}>
        <Space wrap size={6}>
          {EXERCISES.map((ex) => (
            <Button
              key={ex.value}
              type={activeExercises.includes(ex.value) ? 'primary' : 'default'}
              size="small"
              style={
                activeExercises.includes(ex.value)
                  ? {
                      backgroundColor: EXERCISE_COLORS[ex.value],
                      borderColor: EXERCISE_COLORS[ex.value],
                    }
                  : {}
              }
              onClick={() => toggleExercise(ex.value)}
            >
              {ex.label}
            </Button>
          ))}
        </Space>
      </Col>
      <Col xs={24} md={8}>
        <Space size={6} align="center">
          <DatePicker
            value={dayjs(dateFrom)}
            onChange={(d) => d && setDateFrom(d.format('YYYY-MM-DD'))}
            allowClear={false}
            size="small"
          />
          <Typography.Text type="secondary">—</Typography.Text>
          <DatePicker
            value={dayjs(dateTo)}
            onChange={(d) => d && setDateTo(d.format('YYYY-MM-DD'))}
            allowClear={false}
            size="small"
          />
        </Space>
      </Col>
      <Col xs={24} md={4} style={{ textAlign: isMobile ? 'left' : 'right' }}>
        <Space size={6} align="center">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Demo
          </Typography.Text>
          <Switch size="small" checked={useDemoData} onChange={setUseDemoData} />
        </Space>
      </Col>
    </Row>
  )

  const charts = (
    <>
      <SummaryStats
        workouts={displayWorkouts}
        activeExercises={activeExercises}
        isLoading={isLoading && !useDemoData}
      />
      <MainChart workouts={displayWorkouts} activeExercises={activeExercises} />
      <AreaMetricChart workouts={displayWorkouts} activeExercises={activeExercises} />
      <FrequencyChart workouts={displayWorkouts} />
    </>
  )

  return (
    <div style={{ padding: isMobile ? '12px 12px 80px' : '16px 24px 40px' }}>
      {filterBar}

      {isMobile ? (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <WorkoutForm onSuccess={() => void query.refetch()} workouts={workouts} />
          {charts}
        </Space>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>{charts}</div>
          <div style={{ width: 360, flexShrink: 0 }}>
            <WorkoutForm onSuccess={() => void query.refetch()} workouts={workouts} />
          </div>
        </div>
      )}
    </div>
  )
}
