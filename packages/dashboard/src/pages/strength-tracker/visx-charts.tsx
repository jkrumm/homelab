import { curveMonotoneX } from '@visx/curve'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scalePoint } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { Select } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  Bars,
  type BarsBar,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  HoverOverlay,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  VX,
  ZoneRects,
  smartTicks,
  useHoverSync,
  useTooltipStyles,
  useVxTheme,
} from '../../charts'
import {
  EXERCISES,
  METRIC_TOOLTIPS,
  acwrZoneLabel,
  colorForExercise,
  inolDotColor,
} from './constants'
import type { ExerciseKey, Workout } from './types'
import {
  type AcwrChartPoint,
  type BestSetInfo,
  type CompositePoint,
  type InolChartPoint,
  type MomentumPoint,
  type OneRmPoint,
  type WeeklyVolumePoint,
  buildAcwrChartData,
  buildCompositeData,
  buildInolChartData,
  buildMomentumChartData,
  buildOneRmChartData,
  buildWeeklyVolumeData,
  exerciseLabel,
  findPRPoints,
  strengthDirection,
  velocityPctPerDay,
  volumeLandmarks,
} from './utils'

const MARGIN = VX.margin

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtSigma(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}σ`
}

function directionArrow(dir: ReturnType<typeof strengthDirection>): string {
  if (dir === 'improving') return '▲'
  if (dir === 'declining') return '▼'
  return '►'
}

function directionColor(dir: ReturnType<typeof strengthDirection>): string {
  if (dir === 'improving') return VX.goodSolid
  if (dir === 'declining') return VX.badSolid
  return VX.warnSolid
}

function fmtWeight(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1)
}

// ── 1RM Trend Chart ───────────────────────────────────────────────────────

type OneRmInnerProps = {
  data: OneRmPoint[]
  width: number
  height: number
  activeExercises: string[]
  highlighted: string | null
  prSet: Set<string>
  prOpacity: number
  bestEver: Record<string, number | null>
}

function OneRmTrendChartInner({
  data,
  width,
  height,
  activeExercises,
  highlighted,
  prSet,
  prOpacity,
  bestEver,
}: OneRmInnerProps) {
  const { line } = useVxTheme()
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const lineColor = (ex: string) => (activeExercises.length === 1 ? line : colorForExercise(ex))

  const dim = (ex: string): number => {
    if (highlighted === null || highlighted === ex) return 1
    // If highlighted is a non-exercise key (e.g. 'ma', 'pr'), keep all exercise lines visible
    if (!activeExercises.includes(highlighted)) return 1
    return 0.15
  }

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )

  const yScale = useMemo(() => {
    const vals: number[] = []
    for (const pt of data) {
      for (const ex of activeExercises) {
        const v = pt.e1rm[ex]
        if (v !== null) vals.push(v)
        const m = pt.ma[ex]
        if (m !== null) vals.push(m)
      }
    }
    for (const ex of activeExercises) {
      const be = bestEver[ex]
      if (be !== null) vals.push(be)
    }
    if (!vals.length) return scaleLinear<number>({ domain: [0, 200], range: [yMax, 0] })
    const lo = Math.min(...vals) * 0.92
    const hi = Math.max(...vals) * 1.08
    return scaleLinear<number>({ domain: [lo, hi], range: [yMax, 0], nice: true })
  }, [data, activeExercises, bestEver, yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<OneRmPoint>({
      data,
      chartId: 'onerm-trend',
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {/* Best-ever reference lines (very subtle) */}
          {activeExercises.map((ex) => {
            const be = bestEver[ex]
            if (be === null) return null
            return (
              <line
                key={`be-${ex}`}
                x1={0}
                x2={xMax}
                y1={yScale(be)}
                y2={yScale(be)}
                stroke={lineColor(ex)}
                strokeDasharray="2 6"
                strokeOpacity={0.25 * dim(ex)}
              />
            )
          })}

          {/* 30-day MA dashed overlay */}
          {activeExercises.map((ex) => {
            const maValid = data.filter((d) => d.ma[ex] !== null)
            if (maValid.length < 2) return null
            return (
              <LinePath<OneRmPoint>
                key={`ma-${ex}`}
                data={maValid}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.ma[ex]!)}
                stroke={lineColor(ex)}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                strokeOpacity={dim(ex) * 0.6}
                curve={curveMonotoneX}
              />
            )
          })}

          {/* Main e1RM lines */}
          {activeExercises.map((ex) => {
            const valid = data.filter((d) => d.e1rm[ex] !== null)
            if (!valid.length) return null
            return (
              <LinePath<OneRmPoint>
                key={`line-${ex}`}
                data={valid}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.e1rm[ex]!)}
                stroke={lineColor(ex)}
                strokeWidth={2.5}
                strokeOpacity={dim(ex)}
                curve={curveMonotoneX}
              />
            )
          })}

          {/* PR dots with fade-in animation */}
          {activeExercises.flatMap((ex) =>
            data
              .filter((d) => d.e1rm[ex] !== null && prSet.has(`${d.date}_${ex}`))
              .map((d) => (
                <circle
                  key={`pr-${d.date}-${ex}`}
                  cx={xScale(d.date) ?? 0}
                  cy={yScale(d.e1rm[ex]!)}
                  r={6}
                  fill={lineColor(ex)}
                  stroke={VX.dotStroke}
                  strokeWidth={2}
                  fillOpacity={prOpacity * dim(ex)}
                  strokeOpacity={prOpacity * dim(ex)}
                  style={{ transition: 'fill-opacity 500ms ease, stroke-opacity 500ms ease' }}
                />
              )),
          )}

          {/* Crosshair + hover dots */}
          {syncedPoint !== null &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
                  {activeExercises.map((ex) => {
                    const v = syncedPoint.e1rm[ex]
                    if (v === null) return null
                    return (
                      <circle
                        key={`hd-${ex}`}
                        cx={sx}
                        cy={yScale(v)}
                        r={VX.dotR}
                        fill={lineColor(ex)}
                        stroke={VX.dotStroke}
                        strokeWidth={2}
                      />
                    )
                  })}
                </>
              )
            })()}

          <AxisLeftNumeric scale={yScale} numTicks={5} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {activeExercises.map((ex) => {
                const v = tip.data.e1rm[ex]
                if (v === null) return null
                const bs: BestSetInfo | null = tip.data.bestSets[ex]
                const setStr = bs
                  ? ` (${fmtWeight(bs.weight_kg)}×${bs.reps}${bs.rir !== null ? ` @RIR${bs.rir}` : ''} → ${bs.e1rm.toFixed(1)} kg)`
                  : ''
                return (
                  <TooltipRow
                    key={ex}
                    color={lineColor(ex)}
                    label={exerciseLabel(ex)}
                    value={`${v.toFixed(1)} kg${setStr}`}
                    shape="line"
                    strokeWidth={2.5}
                  />
                )
              })}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export function OneRmTrendChart({
  workouts,
  activeExercises,
}: {
  workouts: Workout[]
  activeExercises: string[]
}) {
  const { line } = useVxTheme()
  const chartData = useMemo(
    () => buildOneRmChartData(workouts, activeExercises),
    [workouts, activeExercises],
  )
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const prPoints = useMemo(
    () => findPRPoints(workouts, 'estimated_1rm', activeExercises as ExerciseKey[]),
    [workouts, activeExercises],
  )
  const prSet = useMemo(
    () => new Set(prPoints.map((pr) => `${pr.date}_${pr.exercise}`)),
    [prPoints],
  )

  const [prOpacity, setPrOpacity] = useState(0)
  useEffect(() => {
    setPrOpacity(0)
    const t = setTimeout(() => setPrOpacity(1), 1500)
    return () => clearTimeout(t)
  }, [prPoints])

  const bestEver = useMemo<Record<string, number | null>>(() => {
    const result: Record<string, number | null> = {}
    for (const ex of activeExercises) {
      const vals = workouts
        .filter((w) => w.exercise_id === ex && w.estimated_1rm !== null)
        .map((w) => w.estimated_1rm!)
      result[ex] = vals.length ? Math.max(...vals) : null
    }
    return result
  }, [workouts, activeExercises])

  const headerExtra = useMemo(() => {
    const primaryEx = activeExercises[0]
    if (!primaryEx || !chartData.length) return null
    const latestPt = chartData[chartData.length - 1]
    const latestE1rm = latestPt?.e1rm[primaryEx] ?? null
    const vel = velocityPctPerDay(workouts, primaryEx)
    const dir = strengthDirection(vel)
    if (latestE1rm === null) return null
    return (
      <span style={{ fontSize: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{latestE1rm.toFixed(1)}</span>
        <span style={{ opacity: 0.5 }}> kg </span>
        <span style={{ color: directionColor(dir), fontWeight: 600 }}>{directionArrow(dir)}</span>
      </span>
    )
  }, [chartData, activeExercises, workouts])

  const lineColor = (ex: string) => (activeExercises.length === 1 ? line : colorForExercise(ex))

  if (!chartData.length) {
    return (
      <ChartCard
        title="1RM Trend"
        subtitle="Am I getting stronger?"
        tooltip={METRIC_TOOLTIPS.oneRmTrend}
        extra={null}
      >
        <div
          style={{
            height: 280,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.4,
            fontSize: 13,
          }}
        >
          No workout data in range
        </div>
        <ChartLegend items={[]} highlighted={null} onHighlight={() => {}} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title="1RM Trend"
      subtitle="Am I getting stronger?"
      tooltip={METRIC_TOOLTIPS.oneRmTrend}
      extra={headerExtra}
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <OneRmTrendChartInner
              data={chartData}
              width={Math.max(width, 200)}
              height={280}
              activeExercises={activeExercises}
              highlighted={highlighted}
              prSet={prSet}
              prOpacity={prOpacity}
              bestEver={bestEver}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          ...activeExercises.map((ex) => ({
            key: ex,
            label: exerciseLabel(ex),
            color: lineColor(ex),
            strokeWidth: 2.5 as const,
          })),
          {
            key: 'ma',
            label: '30d avg',
            color: 'rgba(128,128,128,0.55)',
            strokeWidth: 1.5 as const,
            dashed: true,
          },
          {
            key: 'pr',
            label: 'PR',
            color: 'rgba(128,128,128,0.7)',
            shape: 'bar' as const,
          },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}

// ── Strength Composite Chart ──────────────────────────────────────────────

const COMPOSITE_COLORS = {
  velocity: VX.series.hrv,
  tonnage: VX.series.acwr,
  inol: VX.series.vigorousMin,
} as const

type CompositeInnerProps = {
  data: CompositePoint[]
  width: number
  height: number
  chartId: string
  highlighted: string | null
}

function StrengthCompositeChartInner({
  data,
  width,
  height,
  chartId,
  highlighted,
}: CompositeInnerProps) {
  const { axis } = useVxTheme()
  const dim = (key: string): number => (highlighted === null || highlighted === key ? 1 : 0.15)

  const MARGIN_LOCAL = useMemo(() => ({ ...VX.margin, left: Math.max(VX.margin.left, 48) }), [])
  const xMax = width - MARGIN_LOCAL.left - MARGIN_LOCAL.right
  const yMax = height - MARGIN_LOCAL.top - MARGIN_LOCAL.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )

  const yScale = useMemo(() => {
    const vals: number[] = []
    for (const d of data) {
      if (d.velocityZma !== null) vals.push(d.velocityZma)
      if (d.tonnageGrowthZma !== null) vals.push(d.tonnageGrowthZma)
      if (d.inolZma !== null) vals.push(d.inolZma)
    }
    if (!vals.length) return scaleLinear<number>({ domain: [-2, 2], range: [yMax, 0] })
    const maxAbs = Math.min(2.5, Math.max(1.5, Math.max(...vals.map((v) => Math.abs(v))) * 1.1))
    return scaleLinear<number>({ domain: [-maxAbs, maxAbs], range: [yMax, 0], nice: true })
  }, [data, yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<CompositePoint>({
      data,
      chartId,
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN_LOCAL.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  const velValid = useMemo(
    () => data.filter((d): d is CompositePoint & { velocityZma: number } => d.velocityZma !== null),
    [data],
  )
  const tonValid = useMemo(
    () =>
      data.filter(
        (d): d is CompositePoint & { tonnageGrowthZma: number } => d.tonnageGrowthZma !== null,
      ),
    [data],
  )
  const inolValid = useMemo(
    () => data.filter((d): d is CompositePoint & { inolZma: number } => d.inolZma !== null),
    [data],
  )

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN_LOCAL.left} top={MARGIN_LOCAL.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {/* Zero line — personal baseline */}
          <line
            x1={0}
            x2={xMax}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke={axis}
            strokeWidth={1}
            strokeDasharray="2 4"
            strokeOpacity={0.6}
          />

          <LinePath<CompositePoint & { velocityZma: number }>
            data={velValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.velocityZma)}
            stroke={COMPOSITE_COLORS.velocity}
            strokeWidth={2.5}
            strokeOpacity={dim('velocity')}
            curve={curveMonotoneX}
          />
          <LinePath<CompositePoint & { tonnageGrowthZma: number }>
            data={tonValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.tonnageGrowthZma)}
            stroke={COMPOSITE_COLORS.tonnage}
            strokeWidth={2.5}
            strokeOpacity={dim('tonnage')}
            curve={curveMonotoneX}
          />
          <LinePath<CompositePoint & { inolZma: number }>
            data={inolValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.inolZma)}
            stroke={COMPOSITE_COLORS.inol}
            strokeWidth={2.5}
            strokeOpacity={dim('inol')}
            curve={curveMonotoneX}
          />

          {syncedPoint !== null &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
                  {syncedPoint.velocityZma !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.velocityZma)}
                      r={4}
                      fill={COMPOSITE_COLORS.velocity}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                  {syncedPoint.tonnageGrowthZma !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.tonnageGrowthZma)}
                      r={4}
                      fill={COMPOSITE_COLORS.tonnage}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                  {syncedPoint.inolZma !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.inolZma)}
                      r={4}
                      fill={COMPOSITE_COLORS.inol}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                </>
              )
            })()}

          <AxisLeftNumeric scale={yScale} numTicks={5} tickFormat={(v) => fmtSigma(Number(v))} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {tip.data.velocityZ !== null && (
                <TooltipRow
                  color={COMPOSITE_COLORS.velocity}
                  label="Velocity"
                  value={`${tip.data.velocityRaw !== null ? `${tip.data.velocityRaw.toFixed(3)}%/d` : '—'} · ${tip.data.velocityZ !== null ? fmtSigma(tip.data.velocityZ) : '—'}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.tonnageGrowthZ !== null && (
                <TooltipRow
                  color={COMPOSITE_COLORS.tonnage}
                  label="Tonnage"
                  value={`${tip.data.tonnageGrowthRaw !== null ? `×${tip.data.tonnageGrowthRaw.toFixed(2)}` : '—'} · ${tip.data.tonnageGrowthZ !== null ? fmtSigma(tip.data.tonnageGrowthZ) : '—'}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.inolZ !== null && (
                <TooltipRow
                  color={COMPOSITE_COLORS.inol}
                  label="INOL"
                  value={`${tip.data.inolRaw !== null ? tip.data.inolRaw.toFixed(2) : '—'} · ${tip.data.inolZ !== null ? fmtSigma(tip.data.inolZ) : '—'}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export function StrengthCompositeChart({
  workouts,
  activeExercises,
}: {
  workouts: Workout[]
  activeExercises: string[]
}) {
  const [selectedExercise, setSelectedExercise] = useState<string>(
    () => activeExercises[0] ?? EXERCISES[0]!.value,
  )
  // Sync when filter changes: if selected is no longer active, reset to first
  const prevActive = activeExercises.join(',')
  useMemo(() => {
    if (activeExercises.length > 0 && !activeExercises.includes(selectedExercise)) {
      setSelectedExercise(activeExercises[0]!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevActive])

  const [highlighted, setHighlighted] = useState<string | null>(null)
  const chartData = useMemo(
    () => buildCompositeData(workouts, selectedExercise),
    [workouts, selectedExercise],
  )

  const latest = chartData[chartData.length - 1]

  const exerciseSelector =
    activeExercises.length > 1 ? (
      <Select
        size="small"
        value={selectedExercise}
        onChange={setSelectedExercise}
        options={activeExercises.map((ex) => ({
          value: ex,
          label: exerciseLabel(ex),
        }))}
        style={{ minWidth: 100 }}
        popupMatchSelectWidth={false}
      />
    ) : null

  const sigmaChips =
    latest !== null ? (
      <span style={{ fontSize: 12 }}>
        {latest.velocityZma !== null && (
          <span style={{ color: COMPOSITE_COLORS.velocity, marginRight: 8 }}>
            <span style={{ fontWeight: 600 }}>{fmtSigma(latest.velocityZma)}</span>
            <span style={{ opacity: 0.5 }}> f′</span>
          </span>
        )}
        {latest.tonnageGrowthZma !== null && (
          <span style={{ color: COMPOSITE_COLORS.tonnage, marginRight: 8 }}>
            <span style={{ fontWeight: 600 }}>{fmtSigma(latest.tonnageGrowthZma)}</span>
            <span style={{ opacity: 0.5 }}> vol</span>
          </span>
        )}
        {latest.inolZma !== null && (
          <span style={{ color: COMPOSITE_COLORS.inol }}>
            <span style={{ fontWeight: 600 }}>{fmtSigma(latest.inolZma)}</span>
            <span style={{ opacity: 0.5 }}> INOL</span>
          </span>
        )}
      </span>
    ) : null

  const headerExtra = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {sigmaChips}
      {exerciseSelector}
    </span>
  )

  const chartId = `composite-${selectedExercise}`

  if (!chartData.length) {
    return (
      <ChartCard
        title="Strength Composite"
        subtitle="Is the gain broad-based?"
        tooltip={METRIC_TOOLTIPS.strengthComposite}
        extra={exerciseSelector}
      >
        <div
          style={{
            height: 280,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.4,
            fontSize: 13,
          }}
        >
          Not enough data — need at least 2 sessions
        </div>
        <ChartLegend items={[]} highlighted={null} onHighlight={() => {}} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title="Strength Composite"
      subtitle="Is the gain broad-based?"
      tooltip={METRIC_TOOLTIPS.strengthComposite}
      extra={headerExtra}
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <StrengthCompositeChartInner
              data={chartData}
              width={Math.max(width, 200)}
              height={280}
              chartId={chartId}
              highlighted={highlighted}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          {
            key: 'velocity',
            label: 'Velocity (f′)',
            color: COMPOSITE_COLORS.velocity,
            strokeWidth: 2.5,
          },
          {
            key: 'tonnage',
            label: 'Tonnage growth',
            color: COMPOSITE_COLORS.tonnage,
            strokeWidth: 2.5,
          },
          { key: 'inol', label: 'INOL quality', color: COMPOSITE_COLORS.inol, strokeWidth: 2.5 },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}

// ── Weekly Volume Chart ───────────────────────────────────────────────────

export function WeeklyVolumeChart({
  workouts,
  activeExercises,
}: {
  workouts: Workout[]
  activeExercises: string[]
}) {
  const [selectedExercise, setSelectedExercise] = useState<string>(
    () => activeExercises[0] ?? EXERCISES[0]!.value,
  )
  const prevActive = activeExercises.join(',')
  useMemo(() => {
    if (activeExercises.length > 0 && !activeExercises.includes(selectedExercise)) {
      setSelectedExercise(activeExercises[0]!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevActive])

  const [highlighted, setHighlighted] = useState<string | null>(null)

  const chartData = useMemo(
    () => buildWeeklyVolumeData(workouts, selectedExercise),
    [workouts, selectedExercise],
  )
  const landmarks = useMemo(
    () => volumeLandmarks(workouts, selectedExercise),
    [workouts, selectedExercise],
  )

  const exColor = colorForExercise(selectedExercise)

  const positiveBars: BarsBar[] = useMemo(
    () => [
      { key: 'warmup', label: 'Warm-up', color: exColor },
      { key: 'work', label: 'Work', color: exColor },
      { key: 'drop', label: 'Drop', color: exColor },
      { key: 'amrap', label: 'AMRAP', color: VX.warnSolid },
    ],
    [exColor],
  )

  const fmtTonnage = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}t` : `${Math.round(v)}`)

  const exerciseSelector =
    activeExercises.length > 1 ? (
      <Select
        size="small"
        value={selectedExercise}
        onChange={setSelectedExercise}
        options={activeExercises.map((ex) => ({ value: ex, label: exerciseLabel(ex) }))}
        style={{ minWidth: 100 }}
        popupMatchSelectWidth={false}
      />
    ) : null

  const latest = chartData[chartData.length - 1]
  const lastTotal = latest?.total ?? 0
  const headerChip =
    lastTotal > 0 ? (
      <span style={{ fontSize: 12, color: exColor, fontWeight: 600 }}>
        {fmtTonnage(lastTotal)} this week
      </span>
    ) : null

  return (
    <ChartCard
      title="Weekly Volume"
      subtitle="Set type breakdown by week"
      tooltip={METRIC_TOOLTIPS.weeklyVolume}
      extra={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {headerChip}
          {exerciseSelector}
        </span>
      }
    >
      <div style={{ height: 260 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <Bars<WeeklyVolumePoint>
              data={chartData}
              width={Math.max(width, 200)}
              height={260}
              chartId={`weekly-volume-${selectedExercise}`}
              getX={(d) => d.date}
              getValue={(d, key) => {
                if (key === 'warmup') return d.warmup > 0 ? d.warmup : null
                if (key === 'work') return d.work > 0 ? d.work : null
                if (key === 'drop') return d.drop > 0 ? d.drop : null
                if (key === 'amrap') return d.amrap > 0 ? d.amrap : null
                if (key === 'ma') return d.ma
                return null
              }}
              positiveBars={positiveBars}
              barLayout="stacked"
              barOpacity={(_, key) => {
                if (key === 'warmup') return 0.25
                if (key === 'drop') return 0.5
                return 0.85
              }}
              lines={[{ key: 'ma', label: '4w MA', color: exColor, dashed: true, strokeWidth: 2 }]}
              refLines={[
                { value: landmarks.mev, color: VX.goodSolid, dashed: true },
                { value: landmarks.mav, color: VX.warnSolid, dashed: true },
                { value: landmarks.mrv, color: VX.badSolid, dashed: true },
              ]}
              leftAxis={{ domain: 'auto', formatTick: fmtTonnage }}
              formatValue={fmtTonnage}
              highlightedKey={highlighted}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'warmup', label: 'Warm-up', color: exColor, shape: 'bar' },
          { key: 'work', label: 'Work', color: exColor, shape: 'bar' },
          { key: 'drop', label: 'Drop', color: exColor, shape: 'bar' },
          { key: 'amrap', label: 'AMRAP', color: VX.warnSolid, shape: 'bar' },
          { key: 'ma', label: '4w MA', color: exColor, dashed: true },
          { key: 'mev', label: 'MEV', color: VX.goodSolid, dashed: true },
          { key: 'mav', label: 'MAV', color: VX.warnSolid, dashed: true },
          { key: 'mrv', label: 'MRV', color: VX.badSolid, dashed: true },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}

// ── Training Load Chart (ACWR) ────────────────────────────────────────────

const ACWR_ZONE_FILLS = [
  { from: 0, to: 0.8, fill: 'rgba(22, 119, 255, 0.08)' },
  { from: 0.8, to: 1.3, fill: VX.good },
  { from: 1.3, to: 1.5, fill: VX.warn },
  { from: 1.5, to: 2.5, fill: VX.bad },
]

function TrainingLoadChartInner({
  data,
  exercises,
  highlighted,
  width,
  height,
}: {
  data: AcwrChartPoint[]
  exercises: string[]
  highlighted: string | null
  width: number
  height: number
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )
  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, 2.5], range: [yMax, 0] }), [yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<AcwrChartPoint>({
      data,
      chartId: 'training-load',
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  const opa = (ex: string) => (highlighted === null || highlighted === ex ? 1 : 0.1)

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <ZoneRects zones={ACWR_ZONE_FILLS} width={xMax} leftScale={yScale} />
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />
          {[0.8, 1.3, 1.5].map((v) => (
            <line
              key={v}
              x1={0}
              x2={xMax}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke={v === 0.8 ? VX.goodRef : v === 1.3 ? VX.warnRef : VX.badRef}
              strokeWidth={1}
              strokeDasharray="4,3"
            />
          ))}
          {exercises.map((ex) => {
            const valid = data.filter((d) => d.acwr[ex] !== null)
            if (valid.length < 2) return null
            return (
              <LinePath<AcwrChartPoint>
                key={ex}
                data={valid}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.acwr[ex]!)}
                stroke={colorForExercise(ex)}
                strokeWidth={2.5}
                strokeOpacity={opa(ex)}
                curve={curveMonotoneX}
              />
            )
          })}
          {syncedPoint !== null &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
                  {exercises.map((ex) => {
                    const v = syncedPoint.acwr[ex]
                    if (v === null || v === undefined) return null
                    return (
                      <circle
                        key={ex}
                        cx={sx}
                        cy={yScale(v)}
                        r={4}
                        fill={colorForExercise(ex)}
                        stroke={VX.dotStroke}
                        strokeWidth={2}
                        opacity={opa(ex)}
                      />
                    )
                  })}
                </>
              )
            })()}
          <AxisLeftNumeric scale={yScale} numTicks={5} tickFormat={(v) => Number(v).toFixed(1)} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {exercises.map((ex) => {
                const v = tip.data.acwr[ex]
                const zone = tip.data.zone[ex]
                if (v === null || v === undefined) return null
                return (
                  <TooltipRow
                    key={ex}
                    color={colorForExercise(ex)}
                    label={exerciseLabel(ex)}
                    value={`${v.toFixed(2)}${zone ? ` · ${acwrZoneLabel(zone)}` : ''}`}
                    shape="line"
                    strokeWidth={2.5}
                  />
                )
              })}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export function TrainingLoadChart({
  workouts,
  activeExercises,
}: {
  workouts: Workout[]
  activeExercises: string[]
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const chartData = useMemo(
    () => buildAcwrChartData(workouts, activeExercises as ExerciseKey[]),
    [workouts, activeExercises],
  )

  if (!chartData.length) {
    return (
      <ChartCard
        title="Training Load (ACWR)"
        subtitle="Acute:chronic workload ratio"
        tooltip={METRIC_TOOLTIPS.trainingLoad}
      >
        <div
          style={{
            height: 260,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.4,
            fontSize: 13,
          }}
        >
          Not enough data — need at least 4 weeks
        </div>
        <ChartLegend items={[]} highlighted={null} onHighlight={() => {}} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title="Training Load (ACWR)"
      subtitle="Acute:chronic workload ratio"
      tooltip={METRIC_TOOLTIPS.trainingLoad}
    >
      <div style={{ height: 260 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <TrainingLoadChartInner
              data={chartData}
              exercises={activeExercises}
              highlighted={highlighted}
              width={Math.max(width, 200)}
              height={260}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          ...activeExercises.map((ex) => ({
            key: ex,
            label: exerciseLabel(ex),
            color: colorForExercise(ex),
            strokeWidth: 2.5,
          })),
          {
            key: 'zone-under',
            label: 'Undertrained',
            color: 'rgba(22,119,255,0.5)',
            shape: 'bar' as const,
          },
          { key: 'zone-opt', label: 'Optimal', color: VX.goodSolid, shape: 'bar' as const },
          { key: 'zone-caut', label: 'Caution', color: VX.warnSolid, shape: 'bar' as const },
          { key: 'zone-danger', label: 'Danger', color: VX.badSolid, shape: 'bar' as const },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}

// ── INOL Chart ────────────────────────────────────────────────────────────

const INOL_ZONE_FILLS = [
  { from: 0, to: 0.4, fill: 'rgba(22, 119, 255, 0.08)' },
  { from: 0.4, to: 0.6, fill: 'rgba(210, 153, 34, 0.06)' },
  { from: 0.6, to: 1.0, fill: VX.good },
  { from: 1.0, to: 1.5, fill: VX.warn },
  { from: 1.5, to: 3.0, fill: VX.bad },
]

function InolChartInner({
  data,
  exerciseId,
  width,
  height,
}: {
  data: InolChartPoint[]
  exerciseId: string
  width: number
  height: number
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )

  const yMaxVal = useMemo(() => {
    const vals = data.map((d) => d.inol ?? 0).filter((v) => v > 0)
    return Math.max(...vals, 2.0) * 1.1
  }, [data])

  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, yMaxVal], range: [yMax, 0], nice: true }),
    [yMaxVal, yMax],
  )

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<InolChartPoint>({
      data,
      chartId: `inol-${exerciseId}`,
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  const validMA = data.filter((d) => d.ma10 !== null)

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <ZoneRects zones={INOL_ZONE_FILLS} width={xMax} leftScale={yScale} />
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={4} />
          {[0.6, 1.0, 1.5].map((v) => (
            <line
              key={v}
              x1={0}
              x2={xMax}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke={v === 0.6 ? VX.goodRef : v === 1.0 ? VX.warnRef : VX.badRef}
              strokeWidth={1}
              strokeDasharray="4,3"
            />
          ))}
          {data.map((d) => {
            if (d.inol === null) return null
            const sx = xScale(d.date)
            if (sx === undefined) return null
            return (
              <circle
                key={d.date}
                cx={sx}
                cy={yScale(d.inol)}
                r={4}
                fill={inolDotColor(d.inol)}
                fillOpacity={0.75}
                stroke="none"
              />
            )
          })}
          {validMA.length >= 2 && (
            <LinePath<InolChartPoint>
              data={validMA}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScale(d.ma10!)}
              stroke={colorForExercise(exerciseId)}
              strokeWidth={2}
              curve={curveMonotoneX}
            />
          )}
          {syncedPoint !== null &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
                  {syncedPoint.inol !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.inol)}
                      r={5}
                      fill={inolDotColor(syncedPoint.inol)}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                </>
              )
            })()}
          <AxisLeftNumeric scale={yScale} numTicks={4} tickFormat={(v) => Number(v).toFixed(1)} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {tip.data.inol !== null && (
                <TooltipRow
                  color={inolDotColor(tip.data.inol)}
                  label="INOL"
                  value={tip.data.inol.toFixed(2)}
                />
              )}
              {tip.data.ma10 !== null && (
                <TooltipRow
                  color={colorForExercise(exerciseId)}
                  label="10-session MA"
                  value={tip.data.ma10.toFixed(2)}
                  shape="line"
                  strokeWidth={2}
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export function InolChart({
  workouts,
  activeExercises,
}: {
  workouts: Workout[]
  activeExercises: string[]
}) {
  const [selectedExercise, setSelectedExercise] = useState<string>(
    () => activeExercises[0] ?? EXERCISES[0]!.value,
  )
  const prevActive = activeExercises.join(',')
  useMemo(() => {
    if (activeExercises.length > 0 && !activeExercises.includes(selectedExercise)) {
      setSelectedExercise(activeExercises[0]!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevActive])

  const chartData = useMemo(
    () => buildInolChartData(workouts, selectedExercise),
    [workouts, selectedExercise],
  )

  const exerciseSelector =
    activeExercises.length > 1 ? (
      <Select
        size="small"
        value={selectedExercise}
        onChange={setSelectedExercise}
        options={activeExercises.map((ex) => ({ value: ex, label: exerciseLabel(ex) }))}
        style={{ minWidth: 100 }}
        popupMatchSelectWidth={false}
      />
    ) : null

  const latest = chartData[chartData.length - 1]

  return (
    <ChartCard
      title="INOL"
      subtitle="Session load quality"
      tooltip={METRIC_TOOLTIPS.inol}
      extra={exerciseSelector}
    >
      {latest && (
        <div style={{ marginBottom: 4, fontSize: 12 }}>
          {latest.inol !== null && (
            <span style={{ color: inolDotColor(latest.inol), fontWeight: 600, marginRight: 8 }}>
              {latest.inol.toFixed(2)} last session
            </span>
          )}
          {latest.ma10 !== null && (
            <span style={{ opacity: 0.55 }}>10-session avg {latest.ma10.toFixed(2)}</span>
          )}
        </div>
      )}
      <div style={{ height: 240 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <InolChartInner
              data={chartData}
              exerciseId={selectedExercise}
              width={Math.max(width, 200)}
              height={240}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'dots', label: 'Session', color: VX.goodSolid, shape: 'bar' },
          { key: 'ma', label: '10s MA', color: colorForExercise(selectedExercise), strokeWidth: 2 },
          { key: 'opt', label: 'Optimal (0.6–1.0)', color: VX.goodSolid, shape: 'bar' },
          { key: 'caut', label: 'High (1.0–1.5)', color: VX.warnSolid, shape: 'bar' },
          { key: 'excess', label: 'Excessive (>1.5)', color: VX.badSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

// ── Momentum Chart ────────────────────────────────────────────────────────

function MomentumChartInner({
  data,
  exerciseId,
  width,
  height,
}: {
  data: MomentumPoint[]
  exerciseId: string
  width: number
  height: number
}) {
  const gap = 10
  const topH = Math.round((height - gap) * 0.65)
  const bottomH = height - topH - gap
  const xMax = width - MARGIN.left - MARGIN.right
  const yMaxTop = topH - MARGIN.top - 4
  const yMaxBottom = bottomH - 4 - MARGIN.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )

  const e1rmVals = data.map((d) => d.e1rm ?? 0).filter((v) => v > 0)
  const yScaleTop = useMemo(() => {
    if (!e1rmVals.length) return scaleLinear<number>({ domain: [0, 200], range: [yMaxTop, 0] })
    const lo = Math.min(...e1rmVals) * 0.92
    const hi = Math.max(...e1rmVals) * 1.08
    return scaleLinear<number>({ domain: [lo, hi], range: [yMaxTop, 0], nice: true })
  }, [e1rmVals, yMaxTop])

  const velVals = data.map((d) => d.velocity ?? 0)
  const velExtent = Math.max(...velVals.map(Math.abs), 0.1)
  const yScaleBottom = useMemo(
    () =>
      scaleLinear<number>({ domain: [-velExtent, velExtent], range: [yMaxBottom, 0], nice: true }),
    [velExtent, yMaxBottom],
  )

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<MomentumPoint>({
      data,
      chartId: `momentum-${exerciseId}`,
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )
  const exColor = colorForExercise(exerciseId)
  const barW = Math.max((xMax / data.length) * 0.5, 2)

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        {/* Top panel: e1RM + MA */}
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScaleTop} width={xMax} stroke={VX.grid} numTicks={4} />
          {data.map((d) => {
            if (d.e1rm === null) return null
            const sx = xScale(d.date)
            if (sx === undefined) return null
            return (
              <circle
                key={d.date}
                cx={sx}
                cy={yScaleTop(d.e1rm)}
                r={3}
                fill={exColor}
                fillOpacity={0.6}
                stroke="none"
              />
            )
          })}
          <LinePath<MomentumPoint>
            data={data.filter((d) => d.e1rmMA !== null)}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScaleTop(d.e1rmMA!)}
            stroke={exColor}
            strokeWidth={2.5}
            curve={curveMonotoneX}
          />
          {syncedPoint !== null &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMaxTop} stroke={VX.crosshair} strokeWidth={1} />
                  {syncedPoint.e1rm !== null && (
                    <circle
                      cx={sx}
                      cy={yScaleTop(syncedPoint.e1rm)}
                      r={4}
                      fill={exColor}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                </>
              )
            })()}
          <AxisLeftNumeric
            scale={yScaleTop}
            numTicks={4}
            tickFormat={(v) => `${Math.round(Number(v))}`}
          />
        </Group>

        {/* Bottom panel: velocity bars */}
        <Group left={MARGIN.left} top={MARGIN.top + topH + gap}>
          <GridRows scale={yScaleBottom} width={xMax} stroke={VX.grid} numTicks={3} />
          <line
            x1={0}
            x2={xMax}
            y1={yScaleBottom(0)}
            y2={yScaleBottom(0)}
            stroke={VX.crosshair}
            strokeWidth={1}
          />
          {data.map((d) => {
            if (d.velocity === null) return null
            const sx = xScale(d.date)
            if (sx === undefined) return null
            const y0 = yScaleBottom(0)
            const y1 = yScaleBottom(d.velocity)
            const barColor = d.velocity >= 0 ? VX.goodSolid : VX.badSolid
            return (
              <rect
                key={d.date}
                x={sx - barW / 2}
                y={Math.min(y0, y1)}
                width={barW}
                height={Math.abs(y0 - y1)}
                fill={barColor}
                fillOpacity={0.7}
              />
            )
          })}
          {syncedPoint !== null && (
            <line
              x1={xScale(syncedPoint.date) ?? 0}
              x2={xScale(syncedPoint.date) ?? 0}
              y1={0}
              y2={yMaxBottom}
              stroke={VX.crosshair}
              strokeWidth={1}
            />
          )}
          <AxisLeftNumeric
            scale={yScaleBottom}
            numTicks={3}
            tickFormat={(v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}`}
          />
          <AxisBottomDate top={yMaxBottom} scale={xScale} tickValues={tickValues} />
          <HoverOverlay
            width={xMax}
            height={yMaxBottom + MARGIN.bottom}
            onMove={handleMouse}
            onLeave={handleLeave}
          />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {tip.data.e1rm !== null && (
                <TooltipRow color={exColor} label="e1RM" value={`${tip.data.e1rm.toFixed(1)} kg`} />
              )}
              {tip.data.e1rmMA !== null && (
                <TooltipRow
                  color={exColor}
                  label="8-session MA"
                  value={`${tip.data.e1rmMA.toFixed(1)} kg`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.velocity !== null && (
                <TooltipRow
                  color={tip.data.velocity >= 0 ? VX.goodSolid : VX.badSolid}
                  label="Velocity"
                  value={`${tip.data.velocity >= 0 ? '+' : ''}${tip.data.velocity.toFixed(3)} %/day`}
                  shape="bar"
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export function MomentumChart({
  workouts,
  activeExercises,
}: {
  workouts: Workout[]
  activeExercises: string[]
}) {
  const [selectedExercise, setSelectedExercise] = useState<string>(
    () => activeExercises[0] ?? EXERCISES[0]!.value,
  )
  const prevActive = activeExercises.join(',')
  useMemo(() => {
    if (activeExercises.length > 0 && !activeExercises.includes(selectedExercise)) {
      setSelectedExercise(activeExercises[0]!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevActive])

  const chartData = useMemo(
    () => buildMomentumChartData(workouts, selectedExercise),
    [workouts, selectedExercise],
  )

  const exerciseSelector =
    activeExercises.length > 1 ? (
      <Select
        size="small"
        value={selectedExercise}
        onChange={setSelectedExercise}
        options={activeExercises.map((ex) => ({ value: ex, label: exerciseLabel(ex) }))}
        style={{ minWidth: 100 }}
        popupMatchSelectWidth={false}
      />
    ) : null

  const latest = chartData[chartData.length - 1]
  const exColor = colorForExercise(selectedExercise)

  const headerChip =
    latest?.e1rmMA !== null ? (
      <span style={{ fontSize: 12, color: exColor, fontWeight: 600 }}>
        {latest?.e1rmMA?.toFixed(1)} kg MA
      </span>
    ) : null

  if (!chartData.length) {
    return (
      <ChartCard
        title="e1RM Momentum"
        subtitle="Strength trend + velocity"
        tooltip={METRIC_TOOLTIPS.momentum}
        extra={exerciseSelector}
      >
        <div
          style={{
            height: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.4,
            fontSize: 13,
          }}
        >
          Not enough data — need at least 2 sessions
        </div>
        <ChartLegend items={[]} highlighted={null} onHighlight={() => {}} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title="e1RM Momentum"
      subtitle="Strength trend + velocity"
      tooltip={METRIC_TOOLTIPS.momentum}
      extra={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {headerChip}
          {exerciseSelector}
        </span>
      }
    >
      <div style={{ height: 300 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <MomentumChartInner
              data={chartData}
              exerciseId={selectedExercise}
              width={Math.max(width, 200)}
              height={300}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'e1rm', label: 'e1RM', color: exColor, shape: 'bar' },
          { key: 'ma', label: '8-session MA', color: exColor, strokeWidth: 2.5 },
          { key: 'vel-up', label: 'Velocity ▲', color: VX.goodSolid, shape: 'bar' },
          { key: 'vel-down', label: 'Velocity ▼', color: VX.badSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}
