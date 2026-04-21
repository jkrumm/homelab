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
  ChartCard,
  ChartLegend,
  ChartTooltip,
  HoverOverlay,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  VX,
  smartTicks,
  useHoverSync,
  useTooltipStyles,
  useVxTheme,
} from '../../charts'
import { EXERCISES, METRIC_TOOLTIPS, colorForExercise } from './constants'
import type { ExerciseKey, Workout } from './types'
import {
  type BestSetInfo,
  type CompositePoint,
  type OneRmPoint,
  buildCompositeData,
  buildOneRmChartData,
  exerciseLabel,
  findPRPoints,
  strengthDirection,
  velocityPctPerDay,
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
