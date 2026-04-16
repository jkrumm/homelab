import { useList } from '@refinedev/core'
import { UndoOutlined } from '@ant-design/icons'
import { Button, DatePicker, Segmented, Select, Space } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AreaMetricChart, FrequencyChart, MainChart } from './charts'
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

  const initRange = getDateRange(datePreset, customRange)
  const [dateFrom, setDateFrom] = useState(initRange[0])
  const [dateTo, setDateTo] = useState(initRange[1])

  const applyPreset = useCallback(
    (preset: DatePreset, range: [string, string] = customRange) => {
      setDatePreset(preset)
      const [from, to] = getDateRange(preset, range)
      setDateFrom(from)
      setDateTo(to)
    },
    [customRange, setDatePreset],
  )
  const [view, setView] = useLocalState<'charts' | 'history'>('st-view', 'charts')
  const [useDemoData, setUseDemoData] = useLocalState('st-demo-data', false)

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
        <Segmented
          options={[
            { label: 'Charts', value: 'charts' },
            { label: 'History', value: 'history' },
          ]}
          value={view}
          onChange={(v) => setView(v as 'charts' | 'history')}
        />
        <Select
          value={datePreset}
          onChange={(v) => applyPreset(v)}
          options={DATE_PRESET_OPTIONS}
          style={{ minWidth: 100 }}
        />
        {datePreset === 'custom' && (
          <DatePicker.RangePicker
            value={[dayjs(customRange[0]), dayjs(customRange[1])]}
            onChange={(dates) => {
              if (dates?.[0] && dates?.[1]) {
                const range: [string, string] = [
                  dates[0].format('YYYY-MM-DD'),
                  dates[1].format('YYYY-MM-DD'),
                ]
                setCustomRange(range)
                applyPreset('custom', range)
              }
            }}
            allowClear={false}
          />
        )}
        <Space.Compact>
          <Button
            icon={<UndoOutlined />}
            onClick={resetConfig}
            style={{ opacity: 0.65 }}
          >
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
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: EXERCISE_COLORS[ex.value],
                    flexShrink: 0,
                  }}
                />
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
          <MainChart workouts={displayWorkouts} activeExercises={activeExercises} />
          <AreaMetricChart workouts={displayWorkouts} activeExercises={activeExercises} />
          <FrequencyChart workouts={displayWorkouts} activeExercises={activeExercises} />
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
  )
}
