import { TrophyOutlined } from '@ant-design/icons'
import { Card, Empty, Select } from 'antd'
import dayjs from 'dayjs'
import { useMemo } from 'react'
import { EXERCISE_COLORS, METRICS } from './constants'
import type { ExerciseKey, MetricKey, Workout } from './types'
import { useLocalState } from './use-local-state'
import { exerciseLabel, findPRPoints, type PRPoint } from './utils'

const RECORD_METRICS: MetricKey[] = [
  'estimated_1rm',
  'max_weight',
  'total_volume',
  'total_reps',
  'work_sets',
]

interface RecordEntry extends PRPoint {
  metric: MetricKey
  metricLabel: string
  unit: string
}

export function RecentRecords({
  workouts,
  activeExercises,
}: {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
}) {
  const [metricFilter, setMetricFilter] = useLocalState<MetricKey | 'all'>(
    'st-record-filter',
    'all',
  )

  const records = useMemo(() => {
    const metrics = metricFilter === 'all' ? RECORD_METRICS : [metricFilter]
    const entries: RecordEntry[] = []
    for (const metric of metrics) {
      const meta = METRICS.find((m) => m.value === metric)
      const prs = findPRPoints(workouts, metric, activeExercises)
      for (const pr of prs) {
        entries.push({
          ...pr,
          metric,
          metricLabel: meta?.label ?? metric,
          unit: meta?.unit ?? '',
        })
      }
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date))
  }, [workouts, activeExercises, metricFilter])

  const multiExercise = activeExercises.length > 1

  const filterOptions = [
    { value: 'all', label: 'All' },
    ...RECORD_METRICS.map((m) => ({
      value: m,
      label: METRICS.find((mt) => mt.value === m)?.label ?? m,
    })),
  ]

  return (
    <Card
      title="Recent Records"
      size="small"
      style={{ marginTop: 16 }}
      extra={
        <Select
          value={metricFilter}
          onChange={setMetricFilter}
          options={filterOptions}
          size="small"
          style={{ width: 110 }}
          popupMatchSelectWidth={false}
        />
      }
    >
      {records.length === 0 ? (
        <Empty
          description="Log more workouts to see records"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div style={{ maxHeight: 360, overflow: 'auto', scrollbarWidth: 'none' }}>
          {records.slice(0, 30).map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 0,
                padding: '4px 0',
                borderBottom:
                  i < Math.min(records.length, 30) - 1
                    ? '1px solid rgba(128,128,128,0.06)'
                    : undefined,
              }}
            >
              <TrophyOutlined
                style={{
                  width: 20,
                  fontSize: 11,
                  color: 'rgba(128,128,128,0.35)',
                  flexShrink: 0,
                }}
              />
              {multiExercise && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: EXERCISE_COLORS[r.exercise],
                    flexShrink: 0,
                    marginRight: 6,
                  }}
                />
              )}
              <span
                style={{
                  width: multiExercise ? 80 : 90,
                  fontSize: 12,
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {exerciseLabel(r.exercise)}
              </span>
              <span
                style={{
                  width: 76,
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                {r.metricLabel}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: 'right',
                  paddingRight: 8,
                }}
              >
                {Number.isInteger(r.value) ? r.value.toLocaleString() : r.value.toFixed(1)} {r.unit}
              </span>
              <span
                style={{
                  width: 46,
                  fontSize: 12,
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {dayjs(r.date).format('MMM D')}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
