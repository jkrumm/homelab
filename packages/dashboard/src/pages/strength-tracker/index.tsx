import { useList } from '@refinedev/core'
import { UndoOutlined } from '@ant-design/icons'
import { Button, Card, Col, DatePicker, Row, Select, Space, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { HoverContext } from '../../charts'
import {
  DATE_PRESET_OPTIONS,
  type DatePreset,
  EXERCISE_COLORS,
  EXERCISES,
  getDateRange,
} from './constants'
import { generateDemoWorkouts } from './demo-data'
import { WorkoutHistory } from './history'
import { RecentRecords } from './records'
import { SummaryStats } from './stats'
import type { ExerciseKey, Workout } from './types'
import { useLocalState, resetConfig } from './use-local-state'
import {
  InolChart,
  MomentumChart,
  OneRmTrendChart,
  StrengthCompositeChart,
  TrainingLoadChart,
  WeeklyVolumeChart,
} from './visx-charts'
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

  const [activeExercises, setActiveExercises] = useLocalState<ExerciseKey[]>('st-exercises', [
    'bench_press',
    'deadlift',
    'squat',
    'pull_ups',
  ])
  const [datePreset, setDatePreset] = useLocalState<DatePreset>('st-date-preset', 'all')
  const [customRange, setCustomRange] = useLocalState<[string, string]>('st-custom-range', [
    dayjs().subtract(3, 'month').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ])

  const [dateFrom, dateTo] = useMemo(
    () => getDateRange(datePreset, customRange),
    [datePreset, customRange],
  )

  const [view, setView] = useLocalState<'charts' | 'history'>('st-view', 'charts')
  const [useDemoData, setUseDemoData] = useLocalState('st-demo-data', false)

  const [hover, setHoverState] = useState<{ date: string | null; source: string | null }>({
    date: null,
    source: null,
  })
  const setHover = useCallback(
    (date: string | null, source: string | null) => setHoverState({ date, source }),
    [],
  )
  const hoverCtx = useMemo(() => ({ ...hover, setHover }), [hover, setHover])

  const toggleExercise = useCallback(
    (ex: ExerciseKey) => {
      setActiveExercises(
        activeExercises.includes(ex)
          ? activeExercises.filter((e) => e !== ex)
          : [...activeExercises, ex],
      )
    },
    [activeExercises, setActiveExercises],
  )

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
      <Space size={8} wrap align="center">
        <Space.Compact>
          <Button
            onClick={() => setView('charts')}
            style={view === 'charts' ? { fontWeight: 600 } : { opacity: 0.65 }}
          >
            Charts
          </Button>
          <Button
            onClick={() => setView('history')}
            style={view === 'history' ? { fontWeight: 600 } : { opacity: 0.65 }}
          >
            History
          </Button>
        </Space.Compact>
        <Select
          value={datePreset}
          onChange={(v) => setDatePreset(v)}
          options={DATE_PRESET_OPTIONS}
          style={{ minWidth: 100 }}
        />
        {datePreset === 'custom' && (
          <DatePicker.RangePicker
            value={[dayjs(customRange[0]), dayjs(customRange[1])]}
            onChange={(dates) => {
              if (dates?.[0] && dates?.[1]) {
                setCustomRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')])
              }
            }}
            allowClear={false}
          />
        )}
        <Space.Compact>
          <Button icon={<UndoOutlined />} onClick={resetConfig} style={{ opacity: 0.65 }}>
            Reset
          </Button>
          <Button
            onClick={() => setUseDemoData(!useDemoData)}
            style={useDemoData ? { fontWeight: 600 } : { opacity: 0.65 }}
          >
            Demo
          </Button>
        </Space.Compact>
      </Space>

      <Space.Compact>
        {EXERCISES.map((ex) => {
          const active = activeExercises.includes(ex.value)
          return (
            <Button
              key={ex.value}
              style={{ opacity: active ? 1 : 0.4 }}
              onClick={() => toggleExercise(ex.value)}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {!isMobile && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: EXERCISE_COLORS[ex.value],
                      flexShrink: 0,
                    }}
                  />
                )}
                {ex.label}
              </span>
            </Button>
          )
        })}
      </Space.Compact>
    </div>
  )

  const content = (
    <>
      <SummaryStats
        workouts={displayWorkouts}
        activeExercises={activeExercises}
        isLoading={isLoading && !useDemoData}
      />
      {view === 'charts' ? (
        <>
          <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
            Strength Trajectory
          </Typography.Title>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <OneRmTrendChart workouts={displayWorkouts} activeExercises={activeExercises} />
            </Col>
            <Col xs={24} lg={12}>
              <StrengthCompositeChart
                workouts={displayWorkouts}
                activeExercises={activeExercises}
              />
            </Col>
          </Row>

          <Typography.Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>
            Load Quality
          </Typography.Title>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <WeeklyVolumeChart workouts={displayWorkouts} activeExercises={activeExercises} />
            </Col>
            <Col xs={24} lg={12}>
              <TrainingLoadChart workouts={displayWorkouts} activeExercises={activeExercises} />
            </Col>
          </Row>

          <Typography.Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>
            Efficiency &amp; Momentum
          </Typography.Title>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <InolChart workouts={displayWorkouts} activeExercises={activeExercises} />
            </Col>
            <Col xs={24} lg={12}>
              <MomentumChart workouts={displayWorkouts} activeExercises={activeExercises} />
            </Col>
          </Row>

          <Typography.Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>
            Balance
          </Typography.Title>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card size="small">
                <Typography.Text type="secondary">Coming in Group 5</Typography.Text>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small">
                <Typography.Text type="secondary">Coming in Group 5</Typography.Text>
              </Card>
            </Col>
          </Row>
        </>
      ) : (
        <WorkoutHistory
          workouts={displayWorkouts}
          activeExercises={activeExercises}
          isLoading={isLoading && !useDemoData}
          onMutate={() => void query.refetch()}
        />
      )}
    </>
  )

  return (
    <HoverContext.Provider value={hoverCtx}>
      <div style={{ padding: isMobile ? '12px 12px 80px' : '16px 24px 40px' }}>
        {filterBar}

        {isMobile ? (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <WorkoutForm onSuccess={() => void query.refetch()} workouts={workouts} />
            {content}
            <RecentRecords workouts={displayWorkouts} activeExercises={activeExercises} />
          </Space>
        ) : (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>{content}</div>
            <div style={{ width: 360, flexShrink: 0 }}>
              <WorkoutForm onSuccess={() => void query.refetch()} workouts={workouts} />
              <RecentRecords workouts={displayWorkouts} activeExercises={activeExercises} />
            </div>
          </div>
        )}
      </div>
    </HoverContext.Provider>
  )
}
