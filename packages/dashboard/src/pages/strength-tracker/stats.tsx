import { Card, Col, Row, Spin, Tooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import { VX } from '../../charts'
import { METRIC_TOOLTIPS } from './constants'
import type { ExerciseKey, Workout } from './types'
import {
  computeBalanceComposite,
  computeLoadQuality,
  computeStrengthDirectionHero,
  computeStrengthRatios,
  type RatioStatus,
} from './analytics'
import { exerciseLabel } from './utils'

function InfoIcon({ tooltip }: { tooltip: string }) {
  return (
    <Tooltip title={tooltip} placement="bottom">
      <InfoCircleOutlined
        style={{ fontSize: 11, marginLeft: 4, color: 'rgba(128,128,128,0.45)', cursor: 'help' }}
      />
    </Tooltip>
  )
}

function directionArrow(dir: 'improving' | 'stable' | 'declining'): string {
  if (dir === 'improving') return '▲'
  if (dir === 'declining') return '▼'
  return '►'
}

function directionColor(dir: 'improving' | 'stable' | 'declining'): string {
  if (dir === 'improving') return VX.goodSolid
  if (dir === 'declining') return VX.badSolid
  return VX.warnSolid
}

function loadQualityColor(score: number): string {
  if (score >= 75) return VX.goodSolid
  if (score >= 50) return VX.warnSolid
  return VX.badSolid
}

function balanceColor(status: RatioStatus | null): string {
  if (status === 'critical') return VX.badSolid
  if (status === 'imbalanced') return VX.warnSolid
  if (status === 'balanced') return VX.goodSolid
  return 'rgba(128,128,128,0.5)'
}

function balanceSymbol(status: RatioStatus | null): string {
  if (status === 'critical') return '✗'
  if (status === 'imbalanced') return '△'
  if (status === 'balanced') return '✓'
  return '—'
}

function balanceLabel(status: RatioStatus | null): string {
  if (status === 'critical') return 'Critical'
  if (status === 'imbalanced') return 'Imbalanced'
  if (status === 'balanced') return 'Balanced'
  return 'No data'
}

interface ReadinessInfo {
  score: number
  verdict: 'Push' | 'Normal' | 'Rest'
  driver: string | null
}

interface HeroStatsProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
  bodyWeightKg: number
  gender: 'male' | 'female'
  isLoading: boolean
  readinessInfo?: ReadinessInfo | null
}

export function HeroStats({
  workouts,
  activeExercises,
  bodyWeightKg,
  gender,
  isLoading,
  readinessInfo,
}: HeroStatsProps) {
  const strengthDir = useMemo(
    () => computeStrengthDirectionHero(workouts, activeExercises),
    [workouts, activeExercises],
  )

  const loadQuality = useMemo(
    () => computeLoadQuality(workouts, activeExercises),
    [workouts, activeExercises],
  )

  const ratios = useMemo(
    () => computeStrengthRatios(workouts, bodyWeightKg, gender),
    [workouts, bodyWeightKg, gender],
  )

  const balance = useMemo(() => computeBalanceComposite(ratios), [ratios])

  return (
    <Spin spinning={isLoading}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {/* Strength */}
        <Col xs={24} sm={8}>
          <Card size="small" style={{ height: '100%' }}>
            <div style={{ fontSize: 12, color: 'rgba(128,128,128,0.65)', marginBottom: 4 }}>
              Strength
              <InfoIcon tooltip={METRIC_TOOLTIPS.heroStrength} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: directionColor(strengthDir.direction),
                  lineHeight: 1,
                }}
              >
                {directionArrow(strengthDir.direction)}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: directionColor(strengthDir.direction),
                }}
              >
                {strengthDir.direction === 'improving'
                  ? 'Improving'
                  : strengthDir.direction === 'declining'
                    ? 'Declining'
                    : 'Stable'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.5)', marginTop: 4 }}>
              {strengthDir.leaderExercise !== null && strengthDir.leaderVelocityPctPerMonth !== null
                ? `${exerciseLabel(strengthDir.leaderExercise)} ${strengthDir.leaderVelocityPctPerMonth >= 0 ? '+' : ''}${strengthDir.leaderVelocityPctPerMonth.toFixed(1)}%/mo · ${strengthDir.momentumSign}`
                : 'Need more data'}
            </div>
          </Card>
        </Col>

        {/* Load Quality */}
        <Col xs={24} sm={8}>
          <Card size="small" style={{ height: '100%' }}>
            <div style={{ fontSize: 12, color: 'rgba(128,128,128,0.65)', marginBottom: 4 }}>
              Load Quality
              <InfoIcon tooltip={METRIC_TOOLTIPS.heroLoadQuality} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: loadQualityColor(loadQuality.score),
                  lineHeight: 1,
                }}
              >
                {loadQuality.score}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: loadQualityColor(loadQuality.score),
                }}
              >
                {loadQuality.verdict}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.5)', marginTop: 4 }}>
              {loadQuality.dragComponent !== null
                ? `${loadQuality.dragComponent} ${loadQuality.dragComponent === 'INOL' && loadQuality.latestInol !== null ? `avg ${loadQuality.latestInol.toFixed(2)}` : loadQuality.dragComponent === 'ACWR' && loadQuality.latestAcwr !== null ? `ratio ${loadQuality.latestAcwr.toFixed(2)}` : ''} · dragging score`
                : loadQuality.latestInol !== null
                  ? `INOL ${loadQuality.latestInol.toFixed(2)} · ACWR ${loadQuality.latestAcwr !== null ? loadQuality.latestAcwr.toFixed(2) : '—'}`
                  : 'Need more data'}
            </div>
          </Card>
        </Col>

        {/* Readiness (when wearable data present) or Balance */}
        <Col xs={24} sm={8}>
          <Card size="small" style={{ height: '100%' }}>
            {readinessInfo !== null && readinessInfo !== undefined ? (
              <>
                <div style={{ fontSize: 12, color: 'rgba(128,128,128,0.65)', marginBottom: 4 }}>
                  Readiness
                  <InfoIcon tooltip={METRIC_TOOLTIPS.heroReadiness} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 32,
                      fontWeight: 700,
                      color:
                        readinessInfo.score >= 70
                          ? VX.goodSolid
                          : readinessInfo.score >= 40
                            ? VX.warnSolid
                            : VX.badSolid,
                      lineHeight: 1,
                    }}
                  >
                    {readinessInfo.score}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color:
                        readinessInfo.score >= 70
                          ? VX.goodSolid
                          : readinessInfo.score >= 40
                            ? VX.warnSolid
                            : VX.badSolid,
                    }}
                  >
                    {readinessInfo.verdict}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.5)', marginTop: 4 }}>
                  {readinessInfo.driver ?? 'No recent strength fatigue'}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'rgba(128,128,128,0.65)', marginBottom: 4 }}>
                  Balance
                  <InfoIcon tooltip={METRIC_TOOLTIPS.heroBalance} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 32,
                      fontWeight: 700,
                      color: balanceColor(balance.status),
                      lineHeight: 1,
                    }}
                  >
                    {balanceSymbol(balance.status)}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: balanceColor(balance.status),
                    }}
                  >
                    {balanceLabel(balance.status)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.5)', marginTop: 4 }}>
                  {balance.worstPair !== null && balance.worstPair.ratio !== null
                    ? `${balance.worstPair.label} · ${balance.worstPair.ratio.toFixed(2)} (range ${balance.worstPair.range[0]}–${balance.worstPair.range[1]})`
                    : 'Need data for multiple lifts'}
                </div>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}
