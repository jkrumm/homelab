import { Card, Col, Row, Spin, Statistic, Tooltip, Typography } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import type { ExerciseKey, Workout } from './types'
import { computeSummaryStats } from './utils'

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return null
  const sign = delta >= 0 ? '+' : ''
  const color = delta > 0 ? '#52c41a' : delta < 0 ? '#ff4d4f' : 'rgba(128,128,128,0.6)'
  return (
    <Typography.Text style={{ fontSize: 11, color, marginLeft: 4 }}>
      {sign}
      {delta.toFixed(0)}%
    </Typography.Text>
  )
}

interface SummaryStatsProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
  isLoading: boolean
}

export function SummaryStats({ workouts, activeExercises, isLoading }: SummaryStatsProps) {
  const stats = useMemo(
    () => computeSummaryStats(workouts, activeExercises),
    [workouts, activeExercises],
  )

  const statCards: {
    label: string
    value: string | number
    suffix: string
    delta: number | null
    tooltip: string
  }[] = [
    {
      label: 'Best 1RM',
      value: stats.best1rm > 0 ? stats.best1rm.toFixed(1) : '—',
      suffix: stats.best1rm > 0 ? 'kg' : '',
      delta: null,
      tooltip:
        'Your all-time estimated one-rep max. This is your strength ceiling — the theoretical maximum you could lift for a single rep based on your best performance.',
    },
    {
      label: 'Current 1RM',
      value: stats.current1rmAvg > 0 ? stats.current1rmAvg.toFixed(1) : '—',
      suffix: stats.current1rmAvg > 0 ? 'kg' : '',
      delta: stats.current1rmDelta,
      tooltip:
        'Average estimated 1RM over the last 30 days. The % shows change vs the previous 30 days. Positive = getting stronger. A drop after a deload week is normal.',
    },
    {
      label: 'Vol / week',
      value: Math.round(stats.weeklyVolume),
      suffix: 'kg',
      delta: stats.weeklyVolumeDelta,
      tooltip:
        'Total training volume (sets x reps x weight) in the last 7 days. The % compares to the previous 7 days. Volume is the #1 driver of muscle growth — aim for gradual weekly increases of 5-10%.',
    },
    {
      label: 'Intensity',
      value: stats.avgIntensity !== null ? stats.avgIntensity.toFixed(0) : '—',
      suffix: stats.avgIntensity !== null ? '%' : '',
      delta: null,
      tooltip:
        'Average work set weight as a percentage of your estimated 1RM (last 30 days). 70-85% = hypertrophy zone, 85%+ = maximal strength. Most training should stay in the 70-85% range.',
    },
    {
      label: 'Frequency',
      value: stats.freqPerWeek,
      suffix: 'x/wk',
      delta: null,
      tooltip:
        'Average training sessions per week over the last 30 days. Research shows 2x per muscle group per week is optimal for strength and hypertrophy.',
    },
    {
      label: 'Sessions',
      value: stats.sessionsLast30,
      suffix: '',
      delta: stats.sessionsDelta,
      tooltip:
        'Total training sessions in the last 30 days. The % compares to the previous 30 days. Consistency matters more than intensity — a sudden drop may indicate recovery issues.',
    },
  ]

  return (
    <Spin spinning={isLoading}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {statCards.map((stat) => (
          <Col xs={12} sm={8} md={4} key={stat.label}>
            <Card size="small">
              <Statistic
                title={
                  <span>
                    {stat.label}
                    <DeltaBadge delta={stat.delta} />
                    <Tooltip title={stat.tooltip} placement="bottom">
                      <InfoCircleOutlined
                        style={{
                          fontSize: 11,
                          marginLeft: 4,
                          color: 'rgba(128,128,128,0.45)',
                          cursor: 'help',
                        }}
                      />
                    </Tooltip>
                  </span>
                }
                value={stat.value}
                suffix={stat.suffix}
                valueStyle={{ fontSize: 18 }}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </Spin>
  )
}
