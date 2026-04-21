import { Card, Col, Row, Spin, Tooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import type { DailyMetric } from './types'
import { METRIC_TOOLTIPS, scoreColor } from './constants'
import {
  acwrZoneColor,
  acwrZoneLabel,
  activityComponents,
  computeFitnessDirection,
  computeRecoveryScore,
  computeTrainingLoad,
  fieldAvg,
  latestValue,
  strainDebtCeiling,
} from './utils'

function InfoIcon({ tooltip }: { tooltip: string }) {
  return (
    <Tooltip title={tooltip} placement="bottom">
      <InfoCircleOutlined
        style={{ fontSize: 11, marginLeft: 4, color: 'rgba(128,128,128,0.45)', cursor: 'help' }}
      />
    </Tooltip>
  )
}

interface HeroStatsProps {
  data: DailyMetric[]
  isLoading: boolean
}

export function HeroStats({ data, isLoading }: HeroStatsProps) {
  const recovery = useMemo(() => {
    if (data.length === 0) return null
    const avgHrv = fieldAvg(data, 'hrv_last_night_avg')
    const avgRhr = fieldAvg(data, 'resting_hr')
    const rhrVals = data.map((d) => d.resting_hr).filter((v): v is number => v !== null)
    const minRhr = rhrVals.length > 0 ? Math.min(...rhrVals) : null
    const maxRhr = rhrVals.length > 0 ? Math.max(...rhrVals) : null
    const latest = data[data.length - 1]!
    const yesterday = data.length >= 2 ? data[data.length - 2]! : null
    const yesterdayScore = yesterday
      ? (activityComponents(
          yesterday.steps,
          yesterday.moderate_intensity_min,
          yesterday.vigorous_intensity_min,
        )?.total ?? null)
      : null
    const ceiling = strainDebtCeiling(data)
    const score = computeRecoveryScore(
      latest,
      avgHrv,
      avgRhr,
      minRhr,
      maxRhr,
      yesterdayScore,
      ceiling,
    )
    const label =
      score === null
        ? '\u2014'
        : score >= 70
          ? 'Push hard'
          : score >= 40
            ? 'Normal session'
            : 'Prioritize rest'
    return {
      score,
      label,
      hrv: latestValue(data, 'hrv_last_night_avg'),
      sleep: latestValue(data, 'sleep_score'),
      rhr: latestValue(data, 'resting_hr'),
      bb: latestValue(data, 'bb_highest'),
    }
  }, [data])

  const fitness = useMemo(() => {
    if (data.length < 3) return null
    return computeFitnessDirection(data)
  }, [data])

  const training = useMemo(() => {
    const loadData = computeTrainingLoad(data)
    if (loadData.length === 0) return null
    const latest = loadData[loadData.length - 1]!
    return latest
  }, [data])

  return (
    <Spin spinning={isLoading}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {/* Recovery Score */}
        <Col xs={24} sm={8}>
          <Card size="small" style={{ height: '100%' }}>
            <div style={{ fontSize: 12, color: 'rgba(128,128,128,0.65)', marginBottom: 4 }}>
              Recovery
              <InfoIcon tooltip={METRIC_TOOLTIPS.recoveryScore} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: recovery?.score !== null ? scoreColor(recovery?.score ?? null) : '#999',
                  lineHeight: 1,
                }}
              >
                {recovery?.score ?? '\u2014'}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: recovery?.score !== null ? scoreColor(recovery?.score ?? null) : '#999',
                }}
              >
                {recovery?.label ?? ''}
              </span>
            </div>
            {recovery && (
              <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.5)', marginTop: 4 }}>
                {recovery.hrv !== null && <span>HRV {recovery.hrv}ms</span>}
                {recovery.sleep !== null && <span> | Sleep {recovery.sleep}</span>}
                {recovery.rhr !== null && <span> | RHR {recovery.rhr}</span>}
                {recovery.bb !== null && <span> | BB {recovery.bb}</span>}
              </div>
            )}
          </Card>
        </Col>

        {/* Fitness Direction */}
        <Col xs={24} sm={8}>
          <Card size="small" style={{ height: '100%' }}>
            <div style={{ fontSize: 12, color: 'rgba(128,128,128,0.65)', marginBottom: 4 }}>
              Fitness
              <InfoIcon tooltip={METRIC_TOOLTIPS.fitnessTrends} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: fitness?.color ?? '#999',
                  lineHeight: 1,
                }}
              >
                {fitness?.signal ?? '\u2014'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: fitness?.color ?? '#999' }}>
                {fitness?.label ?? 'Need more data'}
              </span>
            </div>
            {fitness && (
              <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.5)', marginTop: 4 }}>
                {fitness.rhrDelta !== null && (
                  <span style={{ color: fitness.rhrDelta <= 0 ? '#00c853' : '#ff3d00' }}>
                    RHR {fitness.rhrDelta > 0 ? '+' : ''}
                    {fitness.rhrDelta.toFixed(0)}
                  </span>
                )}
                {fitness.hrvDelta !== null && (
                  <span
                    style={{
                      color: fitness.hrvDelta >= 0 ? '#00c853' : '#ff3d00',
                      marginLeft: 8,
                    }}
                  >
                    HRV {fitness.hrvDelta > 0 ? '+' : ''}
                    {fitness.hrvDelta.toFixed(0)}
                  </span>
                )}
                {fitness.vo2max !== null && (
                  <span style={{ marginLeft: 8 }}>VO2 {fitness.vo2max.toFixed(1)}</span>
                )}
              </div>
            )}
          </Card>
        </Col>

        {/* Training Balance */}
        <Col xs={24} sm={8}>
          <Card size="small" style={{ height: '100%' }}>
            <div style={{ fontSize: 12, color: 'rgba(128,128,128,0.65)', marginBottom: 4 }}>
              Training
              <InfoIcon tooltip={METRIC_TOOLTIPS.trainingLoad} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: training ? acwrZoneColor(training.zone) : '#999',
                  lineHeight: 1,
                }}
              >
                {training?.acwr?.toFixed(2) ?? '\u2014'}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: training ? acwrZoneColor(training.zone) : '#999',
                }}
              >
                {training ? acwrZoneLabel(training.zone) : ''}
              </span>
            </div>
            {training && (
              <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.5)', marginTop: 4 }}>
                Acute {training.acute} | Chronic {training.chronic}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}
