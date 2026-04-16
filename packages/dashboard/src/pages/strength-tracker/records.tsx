import { TrophyOutlined } from '@ant-design/icons'
import { Card, Empty, Typography } from 'antd'
import dayjs from 'dayjs'
import { useMemo } from 'react'
import { EXERCISE_COLORS, EXERCISES, METRICS } from './constants'
import type { ExerciseKey, MetricKey, Workout } from './types'
import { findPRPoints, type PRPoint } from './utils'

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
  const records = useMemo(() => {
    const entries: RecordEntry[] = []
    for (const metric of RECORD_METRICS) {
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
  }, [workouts, activeExercises])

  return (
    <Card title="Recent Records" size="small" style={{ marginTop: 16 }}>
      {records.length === 0 ? (
        <Empty
          description="Log more workouts to see records"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {records.slice(0, 30).map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                borderBottom:
                  i < records.length - 1 ? '1px solid rgba(128,128,128,0.1)' : undefined,
              }}
            >
              <TrophyOutlined
                style={{ fontSize: 12, color: 'rgba(128,128,128,0.45)', flexShrink: 0 }}
              />
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: EXERCISE_COLORS[r.exercise],
                  flexShrink: 0,
                }}
              />
              <Typography.Text style={{ fontSize: 12, flexShrink: 0 }}>
                {EXERCISES.find((e) => e.value === r.exercise)?.label ?? r.exercise}
              </Typography.Text>
              <Typography.Text style={{ fontSize: 12, flex: 1, minWidth: 0 }} ellipsis>
                {r.metricLabel}:{' '}
                <strong>
                  {Number.isInteger(r.value) ? r.value.toLocaleString() : r.value.toFixed(1)}{' '}
                  {r.unit}
                </strong>
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                {dayjs(r.date).format('MMM D')}
              </Typography.Text>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
