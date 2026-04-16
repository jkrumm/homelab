import { Card, Col, Row, Spin, Statistic } from 'antd'
import { useMemo } from 'react'
import type { ExerciseKey, Workout } from './types'
import { computeSummaryStats } from './utils'

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

  const trendPrefix = stats.trend === 'up' ? '↑ ' : stats.trend === 'down' ? '↓ ' : '→ '

  const statCards = [
    {
      label: 'Best 1RM',
      value: stats.best1rm > 0 ? stats.best1rm.toFixed(1) : '—',
      suffix: stats.best1rm > 0 ? 'kg' : '',
    },
    {
      label: 'Latest 1RM',
      value: stats.latest1rm > 0 ? stats.latest1rm.toFixed(1) : '—',
      suffix: stats.latest1rm > 0 ? 'kg' : '',
    },
    {
      label: 'PR Weight',
      value: stats.prWeight > 0 ? stats.prWeight.toFixed(1) : '—',
      suffix: stats.prWeight > 0 ? 'kg' : '',
    },
    {
      label: 'Vol. / 7d',
      value: Math.round(stats.weeklyVolume),
      suffix: 'kg',
    },
    {
      label: 'Sessions / 30d',
      value: stats.sessionsLast30,
      suffix: '',
    },
    {
      label: '1RM Trend',
      value: `${trendPrefix}${stats.freqPerWeek}x/wk`,
      suffix: '',
    },
  ]

  return (
    <Spin spinning={isLoading}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {statCards.map((stat) => (
          <Col xs={12} sm={8} md={4} key={stat.label}>
            <Card size="small">
              <Statistic
                title={stat.label}
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
