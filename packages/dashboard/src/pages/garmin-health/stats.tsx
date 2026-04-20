import { Card, Col, Row, Spin, Statistic, Tag, Tooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import type { DailyMetric } from './types'
import { METRIC_TOOLTIPS, hrvStatusColor, scoreColor, stressColor } from './constants'
import {
  computeRecoveryScore,
  fieldAvg,
  formatDuration,
  latestStringValue,
  latestValue,
  periodDelta,
} from './utils'

function DeltaBadge({ delta, invert }: { delta: number | null; invert?: boolean }) {
  if (delta === null) return null
  const adjusted = invert ? -delta : delta
  const sign = adjusted >= 0 ? '+' : ''
  const color = adjusted > 0 ? '#52c41a' : adjusted < 0 ? '#ff4d4f' : 'rgba(128,128,128,0.6)'
  return (
    <span style={{ fontSize: 13, fontWeight: 500, color, marginLeft: 6 }}>
      {sign}
      {adjusted.toFixed(0)}%
    </span>
  )
}

interface TopStatsProps {
  data: DailyMetric[]
  isLoading: boolean
}

export function TopStats({ data, isLoading }: TopStatsProps) {
  const stats = useMemo(() => {
    const sleepScore = latestValue(data, 'sleep_score')
    const bbHigh = latestValue(data, 'bb_highest')
    const hrv = latestValue(data, 'hrv_last_night_avg')
    const hrvStatus = latestStringValue(data, 'hrv_status')
    const restingHr = latestValue(data, 'resting_hr')
    const steps = latestValue(data, 'steps')
    const stress = latestValue(data, 'avg_stress')

    const avgHrv = fieldAvg(data, 'hrv_last_night_avg')
    const avgRhr = fieldAvg(data, 'resting_hr')
    const rhrValues = data.map((d) => d.resting_hr).filter((v): v is number => v !== null)
    const minRhr = rhrValues.length > 0 ? Math.min(...rhrValues) : null
    const maxRhr = rhrValues.length > 0 ? Math.max(...rhrValues) : null

    const latestMetric = data[data.length - 1]
    const recovery = latestMetric
      ? computeRecoveryScore(latestMetric, avgHrv, avgRhr, minRhr, maxRhr)
      : null

    return {
      sleepScore,
      sleepScoreAvg: fieldAvg(data, 'sleep_score'),
      sleepScoreDelta: periodDelta(data, 'sleep_score'),
      sleepDuration: latestValue(data, 'sleep_duration_sec'),
      bbHigh,
      bbHighAvg: fieldAvg(data, 'bb_highest'),
      bbDelta: periodDelta(data, 'bb_highest'),
      hrv,
      hrvStatus,
      hrvAvg: avgHrv,
      hrvDelta: periodDelta(data, 'hrv_last_night_avg'),
      restingHr,
      restingHrAvg: avgRhr,
      restingHrDelta: periodDelta(data, 'resting_hr', true),
      steps,
      stepsAvg: fieldAvg(data, 'steps'),
      stepsDelta: periodDelta(data, 'steps'),
      stress,
      stressAvg: fieldAvg(data, 'avg_stress'),
      stressDelta: periodDelta(data, 'avg_stress', true),
      recovery,
    }
  }, [data])

  const cards = [
    {
      label: 'Sleep Score',
      value: stats.sleepScore ?? '\u2014',
      valueColor: scoreColor(stats.sleepScore),
      suffix: (
        <>
          <DeltaBadge delta={stats.sleepScoreDelta} />
        </>
      ),
      sub: stats.sleepDuration !== null ? formatDuration(stats.sleepDuration) : null,
      tooltip: METRIC_TOOLTIPS.sleepScore,
    },
    {
      label: 'Body Battery',
      value: stats.bbHigh ?? '\u2014',
      valueColor: scoreColor(stats.bbHigh),
      suffix: <DeltaBadge delta={stats.bbDelta} />,
      sub: stats.bbHighAvg !== null ? `avg ${Math.round(stats.bbHighAvg)}` : null,
      tooltip: METRIC_TOOLTIPS.bodyBattery,
    },
    {
      label: 'HRV',
      value: stats.hrv ?? '\u2014',
      valueColor: hrvStatusColor(stats.hrvStatus),
      suffix: (
        <>
          {stats.hrv !== null && <span style={{ fontSize: 13, opacity: 0.6 }}> ms</span>}
          <DeltaBadge delta={stats.hrvDelta} />
        </>
      ),
      sub: stats.hrvStatus ? (
        <Tag
          color={hrvStatusColor(stats.hrvStatus)}
          style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
        >
          {stats.hrvStatus}
        </Tag>
      ) : null,
      tooltip: METRIC_TOOLTIPS.hrv,
    },
    {
      label: 'Resting HR',
      value: stats.restingHr ?? '\u2014',
      valueColor: stats.restingHr !== null ? '#ff5252' : '#999',
      suffix: (
        <>
          {stats.restingHr !== null && <span style={{ fontSize: 13, opacity: 0.6 }}> bpm</span>}
          <DeltaBadge delta={stats.restingHrDelta} invert />
        </>
      ),
      sub: stats.restingHrAvg !== null ? `avg ${Math.round(stats.restingHrAvg)} bpm` : null,
      tooltip: METRIC_TOOLTIPS.restingHr,
    },
    {
      label: 'Steps',
      value: stats.steps !== null ? stats.steps.toLocaleString() : '\u2014',
      valueColor: stats.steps !== null && stats.steps >= 10000 ? '#00c853' : undefined,
      suffix: <DeltaBadge delta={stats.stepsDelta} />,
      sub: stats.stepsAvg !== null ? `avg ${Math.round(stats.stepsAvg).toLocaleString()}` : null,
      tooltip: METRIC_TOOLTIPS.steps,
    },
    {
      label: 'Avg Stress',
      value: stats.stress ?? '\u2014',
      valueColor: stressColor(stats.stress),
      suffix: <DeltaBadge delta={stats.stressDelta} invert />,
      sub: stats.stressAvg !== null ? `avg ${Math.round(stats.stressAvg)}` : null,
      tooltip: METRIC_TOOLTIPS.stress,
    },
  ]

  return (
    <Spin spinning={isLoading}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {cards.map((card) => (
          <Col xs={12} sm={8} md={4} key={card.label}>
            <Card size="small">
              <Statistic
                title={
                  <span>
                    {card.label}
                    <Tooltip title={card.tooltip} placement="bottom">
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
                value={card.value}
                valueStyle={{
                  fontSize: 22,
                  ...(card.valueColor ? { color: card.valueColor } : {}),
                }}
                suffix={card.suffix}
              />
              {card.sub && (
                <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.6)', marginTop: -2 }}>
                  {card.sub}
                </div>
              )}
            </Card>
          </Col>
        ))}
      </Row>
    </Spin>
  )
}
