import { useMemo, useState } from 'react'
import { curveMonotoneX } from '@visx/curve'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scalePoint } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { Threshold } from '@visx/threshold'
import type { DailyMetric } from './types'
import { METRIC_TOOLTIPS } from './constants'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  AxisRightNumeric,
  Bars,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  HoverOverlay,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  VX,
  ZonedLine,
  smartTicks,
  useHoverSync,
  useTooltipStyles,
  useVxTheme,
} from '../../charts'
import {
  ACTIVITY_TARGET_SCORE,
  acwrZoneColor,
  acwrZoneLabel,
  buildActivityData,
  buildFitnessData,
  buildRecoveryTrendData,
  buildSleepChartData,
  computeFitnessSummary,
  computeTrainingLoad,
  formatHoursMin,
  sleepScoreLabel,
  type TrainingLoadPoint,
} from './utils'

const MARGIN = VX.margin

// ── ACWR Threshold Chart ─────────────────────────────────────────────────

export function ACWRThresholdChart({ data }: { data: DailyMetric[] }) {
  const { line } = useVxTheme()
  const loadData = useMemo(() => computeTrainingLoad(data), [data])
  const latest = loadData[loadData.length - 1]

  return (
    <ChartCard
      title="Training Load (ACWR)"
      tooltip={METRIC_TOOLTIPS.trainingLoad}
      extra={
        latest?.acwr !== null && latest?.acwr !== undefined ? (
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            <span style={{ color: acwrZoneColor(latest.zone) }}>{latest.acwr.toFixed(2)}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                marginLeft: 6,
                color: acwrZoneColor(latest.zone),
              }}
            >
              {acwrZoneLabel(latest.zone)}
            </span>
          </span>
        ) : null
      }
    >
      <div style={{ height: 260 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <ZonedLine<TrainingLoadPoint>
              data={loadData}
              width={Math.max(width, 200)}
              height={260}
              chartId="acwr"
              getX={(d) => d.date}
              getY={(d) => d.acwr}
              yDomain="auto"
              yAutoMaxFloor={2}
              zones={[{ from: 0.8, to: 1.3, fill: VX.good }]}
              thresholds={[
                { value: 1.3, side: 'above', fill: VX.bad },
                { value: 0.8, side: 'below', fill: VX.warn },
              ]}
              refLines={[
                { value: 0.8, color: VX.warnRef },
                { value: 1.3, color: VX.goodRef },
                { value: 1.5, color: VX.badRef },
              ]}
              seriesLabel="ACWR"
              formatValue={(v) => v.toFixed(2)}
              tooltipLabel={(d) => ({
                text: acwrZoneLabel(d.zone),
                color: acwrZoneColor(d.zone),
              })}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'acwr', label: 'ACWR', color: line },
          { key: 'optimal', label: 'Optimal (0.8–1.3)', color: VX.goodSolid, shape: 'bar' },
          { key: 'danger', label: 'Overload (>1.5)', color: VX.badSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

// ── Load Divergence Threshold Chart ─────────────────────────────────────

function DivergenceChartInner({
  data,
  width,
  height,
  highlighted,
}: {
  data: TrainingLoadPoint[]
  width: number
  height: number
  highlighted: string | null
}) {
  const gap = 12
  const topH = Math.round((height - gap) * 0.6)
  const bottomH = height - topH - gap
  const xMax = width - MARGIN.left - MARGIN.right
  const yMaxTop = topH - MARGIN.top - 4
  const yMaxBottom = bottomH - 4 - MARGIN.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )

  const loadMax = Math.max(...data.map((d) => Math.max(d.acute, d.chronic)), 1)
  const yScaleTop = useMemo(
    () => scaleLinear<number>({ domain: [0, loadMax * 1.1], range: [yMaxTop, 0], nice: true }),
    [loadMax, yMaxTop],
  )

  const divExtent = Math.max(...data.map((d) => Math.abs(d.divergence)), 1)
  const yScaleBottom = useMemo(
    () =>
      scaleLinear<number>({ domain: [-divExtent, divExtent], range: [yMaxBottom, 0], nice: true }),
    [divExtent, yMaxBottom],
  )

  // Clip paths for color-flipping lines at crossing points
  const clipAboveChronic = useMemo(() => {
    if (data.length < 2) return ''
    const pts = data.map((d) => `${xScale(d.date) ?? 0},${yScaleTop(d.chronic)}`)
    const x0 = xScale(data[0]!.date) ?? 0
    const xN = xScale(data[data.length - 1]!.date) ?? 0
    return `M${x0},0 L${pts.join(' L')} L${xN},0 Z`
  }, [data, xScale, yScaleTop])

  const clipBelowChronic = useMemo(() => {
    if (data.length < 2) return ''
    const pts = data.map((d) => `${xScale(d.date) ?? 0},${yScaleTop(d.chronic)}`)
    const x0 = xScale(data[0]!.date) ?? 0
    const xN = xScale(data[data.length - 1]!.date) ?? 0
    return `M${x0},${yMaxTop} L${pts.join(' L')} L${xN},${yMaxTop} Z`
  }, [data, xScale, yScaleTop, yMaxTop])

  const clipAboveAcute = useMemo(() => {
    if (data.length < 2) return ''
    const pts = data.map((d) => `${xScale(d.date) ?? 0},${yScaleTop(d.acute)}`)
    const x0 = xScale(data[0]!.date) ?? 0
    const xN = xScale(data[data.length - 1]!.date) ?? 0
    return `M${x0},0 L${pts.join(' L')} L${xN},0 Z`
  }, [data, xScale, yScaleTop])

  const clipBelowAcute = useMemo(() => {
    if (data.length < 2) return ''
    const pts = data.map((d) => `${xScale(d.date) ?? 0},${yScaleTop(d.acute)}`)
    const x0 = xScale(data[0]!.date) ?? 0
    const xN = xScale(data[data.length - 1]!.date) ?? 0
    return `M${x0},${yMaxTop} L${pts.join(' L')} L${xN},${yMaxTop} Z`
  }, [data, xScale, yScaleTop, yMaxTop])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<TrainingLoadPoint>({
      data,
      chartId: 'divergence',
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

  const acuteOpa = highlighted === null || highlighted === 'acute' ? 0.7 : 0.1
  const chronicOpa = highlighted === null || highlighted === 'chronic' ? 0.85 : 0.1

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        {/* Top panel: signal lines with threshold fill between them */}
        <Group left={MARGIN.left} top={MARGIN.top}>
          <defs>
            <clipPath id="div-clip-above-chronic">
              <path d={clipAboveChronic} />
            </clipPath>
            <clipPath id="div-clip-below-chronic">
              <path d={clipBelowChronic} />
            </clipPath>
            <clipPath id="div-clip-above-acute">
              <path d={clipAboveAcute} />
            </clipPath>
            <clipPath id="div-clip-below-acute">
              <path d={clipBelowAcute} />
            </clipPath>
          </defs>
          <GridRows scale={yScaleTop} width={xMax} stroke={VX.grid} numTicks={4} />
          <Threshold<TrainingLoadPoint>
            id="div-signal-fill"
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y0={(d) => yScaleTop(d.chronic)}
            y1={(d) => yScaleTop(d.acute)}
            clipAboveTo={0}
            clipBelowTo={yMaxTop}
            curve={curveMonotoneX}
            belowAreaProps={{ fill: VX.good }}
            aboveAreaProps={{ fill: VX.bad }}
          />

          {/* Short-term (acute): green above chronic, red below — thinner, less opacity */}
          <g clipPath="url(#div-clip-above-chronic)">
            <LinePath<TrainingLoadPoint>
              data={data}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScaleTop(d.acute)}
              stroke={VX.goodSolid}
              strokeWidth={2}
              strokeOpacity={acuteOpa}
              curve={curveMonotoneX}
            />
          </g>
          <g clipPath="url(#div-clip-below-chronic)">
            <LinePath<TrainingLoadPoint>
              data={data}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScaleTop(d.acute)}
              stroke={VX.badSolid}
              strokeWidth={2}
              strokeOpacity={acuteOpa}
              curve={curveMonotoneX}
            />
          </g>

          {/* Long-term (chronic): green when acute above, red when acute below — thicker, more opacity */}
          <g clipPath="url(#div-clip-below-acute)">
            <LinePath<TrainingLoadPoint>
              data={data}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScaleTop(d.chronic)}
              stroke={VX.goodSolid}
              strokeWidth={2.5}
              strokeOpacity={chronicOpa}
              curve={curveMonotoneX}
            />
          </g>
          <g clipPath="url(#div-clip-above-acute)">
            <LinePath<TrainingLoadPoint>
              data={data}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScaleTop(d.chronic)}
              stroke={VX.badSolid}
              strokeWidth={2.5}
              strokeOpacity={chronicOpa}
              curve={curveMonotoneX}
            />
          </g>

          {syncedPoint &&
            (() => {
              const bothColor =
                syncedPoint.acute >= syncedPoint.chronic ? VX.goodSolid : VX.badSolid
              return (
                <>
                  <line
                    x1={xScale(syncedPoint.date) ?? 0}
                    x2={xScale(syncedPoint.date) ?? 0}
                    y1={0}
                    y2={yMaxTop}
                    stroke={VX.crosshair}
                    strokeWidth={1}
                  />
                  <circle
                    cx={xScale(syncedPoint.date) ?? 0}
                    cy={yScaleTop(syncedPoint.acute)}
                    r={4}
                    fill={bothColor}
                    stroke={VX.dotStroke}
                    strokeWidth={2}
                  />
                  <circle
                    cx={xScale(syncedPoint.date) ?? 0}
                    cy={yScaleTop(syncedPoint.chronic)}
                    r={4}
                    fill={bothColor}
                    stroke={VX.dotStroke}
                    strokeWidth={2}
                  />
                </>
              )
            })()}
          <AxisLeftNumeric scale={yScaleTop} numTicks={4} />
          <HoverOverlay width={xMax} height={yMaxTop} onMove={handleMouse} onLeave={handleLeave} />
        </Group>

        {/* Bottom panel: divergence bars (MACD histogram) */}
        <Group left={MARGIN.left} top={topH + gap}>
          <GridRows scale={yScaleBottom} width={xMax} stroke={VX.grid} numTicks={3} />
          {data.map((d) => {
            const x = xScale(d.date) ?? 0
            const barWidth = Math.max((xMax / data.length) * 0.6, 2)
            const y0 = yScaleBottom(0)
            const yVal = yScaleBottom(d.divergence)
            const barH = Math.abs(yVal - y0)
            return (
              <rect
                key={d.date}
                x={x - barWidth / 2}
                y={d.divergence >= 0 ? yVal : y0}
                width={barWidth}
                height={barH}
                fill={d.divergence >= 0 ? VX.goodSolid : VX.badSolid}
                fillOpacity={highlighted === null || highlighted === 'divergence' ? 0.6 : 0.1}
                rx={1}
              />
            )
          })}
          <line x1={0} x2={xMax} y1={yScaleBottom(0)} y2={yScaleBottom(0)} stroke={VX.grid} />
          {syncedPoint && (
            <line
              x1={xScale(syncedPoint.date) ?? 0}
              x2={xScale(syncedPoint.date) ?? 0}
              y1={0}
              y2={yMaxBottom}
              stroke={VX.crosshair}
              strokeWidth={1}
            />
          )}
          <AxisLeftNumeric scale={yScaleBottom} numTicks={3} />
          <AxisBottomDate top={yMaxBottom} scale={xScale} tickValues={tickValues} />
          <HoverOverlay
            width={xMax}
            height={yMaxBottom}
            onMove={handleMouse}
            onLeave={handleLeave}
          />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip &&
          isDirectHover &&
          (() => {
            const bothColor = tip.data.acute >= tip.data.chronic ? VX.goodSolid : VX.badSolid
            const divColor = tip.data.divergence >= 0 ? VX.goodSolid : VX.badSolid
            const divLabel = `${tip.data.divergence >= 0 ? '+' : ''}${tip.data.divergence.toFixed(1)}`
            return (
              <>
                <TooltipHeader date={tip.data.date} label={divLabel} labelColor={divColor} />
                <TooltipBody>
                  <TooltipRow
                    color={bothColor}
                    label="Short"
                    value={String(tip.data.acute)}
                    shape="line"
                    strokeWidth={2}
                  />
                  <TooltipRow
                    color={bothColor}
                    label="Long"
                    value={String(tip.data.chronic)}
                    shape="line"
                    strokeWidth={2.5}
                  />
                </TooltipBody>
              </>
            )
          })()}
      </ChartTooltip>
    </div>
  )
}

export function DivergenceThresholdChart({ data }: { data: DailyMetric[] }) {
  const loadData = useMemo(() => computeTrainingLoad(data), [data])
  const [highlighted, setHighlighted] = useState<string | null>(null)

  return (
    <ChartCard title="Load Divergence" tooltip={METRIC_TOOLTIPS.loadBalance}>
      <div style={{ height: 260 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <DivergenceChartInner
              data={loadData}
              width={Math.max(width, 200)}
              height={260}
              highlighted={highlighted}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          {
            key: 'acute',
            label: 'Short-term (7d)',
            color: VX.goodSolid,
            secondColor: VX.badSolid,
            strokeWidth: 2,
            shape: 'splitLine',
          },
          {
            key: 'chronic',
            label: 'Long-term (28d)',
            color: VX.goodSolid,
            secondColor: VX.badSolid,
            strokeWidth: 3,
            shape: 'splitLine',
          },
          {
            key: 'divergence',
            label: 'Divergence',
            color: VX.goodSolid,
            secondColor: VX.badSolid,
            shape: 'split',
          },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}

// ── Sleep Breakdown — diverging stacked bars + score line ──────────────

type SleepPoint = ReturnType<typeof buildSleepChartData>[number]

const SLEEP_KEYS = ['deep', 'light', 'rem', 'awake', 'sleepScore'] as const

const sleepGetValue = (d: SleepPoint, k: string): number | null => {
  switch (k as (typeof SLEEP_KEYS)[number]) {
    case 'deep':
      return d.deep
    case 'light':
      return d.light
    case 'rem':
      return d.rem
    case 'awake':
      return d.awake
    case 'sleepScore':
      return d.sleepScore
  }
  return null
}

export function SleepBreakdownChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildSleepChartData(data), [data])

  return (
    <ChartCard title="Sleep Breakdown" tooltip={METRIC_TOOLTIPS.sleepStages}>
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <Bars<SleepPoint>
              data={chartData}
              width={Math.max(width, 200)}
              height={280}
              chartId="sleep"
              getX={(d) => d.date}
              getValue={sleepGetValue}
              positiveBars={[
                { key: 'deep', label: 'Deep', color: VX.series.deep, formatValue: formatHoursMin },
                {
                  key: 'light',
                  label: 'Light',
                  color: VX.series.light,
                  formatValue: formatHoursMin,
                },
                { key: 'rem', label: 'REM', color: VX.series.rem, formatValue: formatHoursMin },
              ]}
              negativeBars={[
                {
                  key: 'awake',
                  label: 'Awake',
                  color: VX.series.awake,
                  formatValue: formatHoursMin,
                },
              ]}
              lines={[
                {
                  key: 'sleepScore',
                  label: 'Sleep Score',
                  color: VX.series.sleepScore,
                  axisSide: 'right',
                  strokeWidth: 2,
                },
              ]}
              zones={[{ from: 7, to: 9, fill: VX.goodSoft, axisSide: 'left' }]}
              leftAxis={{
                domain: 'auto',
                autoPad: 1.05,
                autoMaxFloor: 9,
                numTicks: 5,
                formatTick: (v) => (v < 0 ? `${Math.abs(v)}h` : `${v}h`),
              }}
              rightAxis={{ domain: [0, 100], numTicks: 4 }}
              tooltipLabel={(d) => sleepScoreLabel(d.sleepScore)}
              renderPrefixTooltipRows={(d) => {
                const total = (d.deep ?? 0) + (d.light ?? 0) + (d.rem ?? 0)
                if (total === 0) return null
                return (
                  <TooltipRow
                    color={VX.series.sleepScore}
                    label="Total"
                    value={`${total.toFixed(1)}h`}
                    shape="line"
                    strokeWidth={2}
                  />
                )
              }}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'deep', label: 'Deep', color: VX.series.deep, shape: 'bar' },
          { key: 'light', label: 'Light', color: VX.series.light, shape: 'bar' },
          { key: 'rem', label: 'REM', color: VX.series.rem, shape: 'bar' },
          { key: 'awake', label: 'Awake', color: VX.series.awake, shape: 'bar' },
          { key: 'sleepScore', label: 'Sleep Score', color: VX.series.sleepScore, strokeWidth: 2 },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

// ── Daily Activity — stacked MET-min Score + 30d trend ──────────────────

type ActivityPoint = ReturnType<typeof buildActivityData>[number]

const activityGetValue = (d: ActivityPoint, k: string): number | null => {
  switch (k) {
    case 'walkingScore':
      return d.walkingScore
    case 'moderateScore':
      return d.moderateScore
    case 'vigorousScore':
      return d.vigorousScore
    case 'scoreMA':
      return d.scoreMA
  }
  return null
}

export function ActivityBarChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildActivityData(data), [data])
  const { line2, tooltipMuted } = useVxTheme()
  const latest = chartData[chartData.length - 1]

  return (
    <ChartCard
      title="Daily Activity"
      tooltip={METRIC_TOOLTIPS.intensityMinutes}
      extra={
        latest?.score !== null && latest?.score !== undefined ? (
          <span style={{ fontSize: 12 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: latest.score >= ACTIVITY_TARGET_SCORE ? VX.goodSolid : tooltipMuted,
              }}
            >
              {Math.round(latest.score)}
            </span>
            <span style={{ opacity: 0.5 }}> Score</span>
          </span>
        ) : null
      }
    >
      <div style={{ height: 220 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <Bars<ActivityPoint>
              data={chartData}
              width={Math.max(width, 200)}
              height={220}
              chartId="activity"
              getX={(d) => d.date}
              getValue={activityGetValue}
              positiveBars={[
                { key: 'walkingScore', label: 'Walking', color: VX.series.steps },
                { key: 'moderateScore', label: 'Moderate', color: VX.series.intensityMin },
                { key: 'vigorousScore', label: 'Vigorous', color: VX.series.vigorousMin },
              ]}
              lines={[
                {
                  key: 'scoreMA',
                  label: '30d avg',
                  color: line2,
                  axisSide: 'left',
                  dashed: true,
                  strokeWidth: 1.5,
                  formatValue: (v) =>
                    `${Math.round(v)} · ${Math.round((v / ACTIVITY_TARGET_SCORE) * 100)}%`,
                },
              ]}
              zones={[
                { from: ACTIVITY_TARGET_SCORE, to: Infinity, fill: VX.goodSoft, axisSide: 'left' },
              ]}
              refLines={[
                {
                  value: ACTIVITY_TARGET_SCORE,
                  color: VX.goodRef,
                  dashed: true,
                  axisSide: 'left',
                },
              ]}
              leftAxis={{
                domain: 'auto',
                autoMaxFloor: ACTIVITY_TARGET_SCORE * 1.2,
                numTicks: 5,
              }}
              tooltipLabel={(d) => {
                if (d.score === null) return null
                const pct = Math.round((d.score / ACTIVITY_TARGET_SCORE) * 100)
                return {
                  text: `${Math.round(d.score)} · ${pct}%`,
                  color: d.score >= ACTIVITY_TARGET_SCORE ? VX.goodSolid : tooltipMuted,
                }
              }}
              hideBarTooltipRows
              renderPrefixTooltipRows={(d) => (
                <>
                  <TooltipRow
                    color={tooltipMuted}
                    label="Vigorous"
                    value={`${d.vigorousMin ?? 0} min`}
                    shape="dot"
                  />
                  <TooltipRow
                    color={tooltipMuted}
                    label="Moderate"
                    value={`${d.moderateMin ?? 0} min`}
                    shape="dot"
                  />
                  <TooltipRow
                    color={tooltipMuted}
                    label="Steps"
                    value={(d.steps ?? 0).toLocaleString()}
                    shape="dot"
                  />
                </>
              )}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'vigorous', label: 'Vigorous', color: VX.series.vigorousMin, shape: 'bar' },
          { key: 'moderate', label: 'Moderate', color: VX.series.intensityMin, shape: 'bar' },
          { key: 'walking', label: 'Walking', color: VX.series.steps, shape: 'bar' },
          {
            key: 'trend',
            label: '30d avg',
            color: line2,
            strokeWidth: 1.5,
            dashed: true,
          },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

// ── Recovery Threshold Chart ────────────────────────────────────────────

type RecoveryPoint = {
  date: string
  recovery: number | null
  sleepScore: number | null
  bbHigh: number | null
}

function recoveryZoneLabel(v: number): { text: string; color: string } {
  if (v >= 70) return { text: 'Push', color: VX.goodSolid }
  if (v >= 40) return { text: 'Normal', color: VX.warnSolid }
  return { text: 'Rest', color: VX.badSolid }
}

export function RecoveryThresholdChart({ data }: { data: DailyMetric[] }) {
  const { line } = useVxTheme()
  const chartData = useMemo(() => buildRecoveryTrendData(data), [data])

  return (
    <ChartCard title="Recovery Trend" tooltip={METRIC_TOOLTIPS.recoveryScore}>
      <div style={{ height: 260 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <ZonedLine<RecoveryPoint>
              data={chartData}
              width={Math.max(width, 200)}
              height={260}
              chartId="recovery"
              getX={(d) => d.date}
              getY={(d) => d.recovery}
              yDomain={[0, 100]}
              zones={[
                { from: 70, to: 100, fill: VX.good },
                { from: 40, to: 70, fill: VX.warn },
                { from: 0, to: 40, fill: VX.bad },
              ]}
              thresholds={[
                { value: 70, side: 'above', fill: VX.good },
                { value: 40, side: 'below', fill: VX.bad },
              ]}
              refLines={[
                { value: 70, color: VX.goodRef },
                { value: 40, color: VX.badRef },
              ]}
              seriesLabel="Recovery"
              formatValue={(v) => String(Math.round(v))}
              tooltipLabel={(d) => (d.recovery === null ? null : recoveryZoneLabel(d.recovery))}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'recovery', label: 'Recovery Score', color: line },
          { key: 'push', label: 'Push (>70)', color: VX.goodSolid, shape: 'bar' },
          { key: 'rest', label: 'Rest (<40)', color: VX.badSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

// ── Fitness Trends — dual-axis RHR + HRV + VO2 Max dots ─────────────────

type FitnessPoint = ReturnType<typeof buildFitnessData>[number]

function FitnessTrendChartInner({
  data,
  width,
  height,
}: {
  data: FitnessPoint[]
  width: number
  height: number
}) {
  const MARGIN_LOCAL = useMemo(
    () => ({
      ...VX.margin,
      left: Math.max(VX.margin.left, 56),
      right: Math.max(VX.margin.right, 48),
    }),
    [],
  )
  const xMax = width - MARGIN_LOCAL.left - MARGIN_LOCAL.right
  const yMax = height - MARGIN_LOCAL.top - MARGIN_LOCAL.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )

  // RHR left axis — padded auto domain
  const leftScale = useMemo(() => {
    const vals = data.map((d) => d.rhrMA).filter((v): v is number => v !== null)
    if (vals.length === 0) return scaleLinear<number>({ domain: [40, 60], range: [yMax, 0] })
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const pad = Math.max((hi - lo) * 0.15, 1)
    return scaleLinear<number>({ domain: [lo - pad, hi + pad], range: [yMax, 0], nice: true })
  }, [data, yMax])

  // HRV + VO2 right axis — shared; VO2 typically 30–70, HRV 20–150
  const rightScale = useMemo(() => {
    const vals: number[] = []
    for (const d of data) {
      if (d.hrvMA !== null) vals.push(d.hrvMA)
      if (d.vo2max !== null) vals.push(d.vo2max)
    }
    if (vals.length === 0) return scaleLinear<number>({ domain: [30, 120], range: [yMax, 0] })
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const pad = Math.max((hi - lo) * 0.15, 2)
    return scaleLinear<number>({ domain: [lo - pad, hi + pad], range: [yMax, 0], nice: true })
  }, [data, yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<FitnessPoint>({
      data,
      chartId: 'fitness',
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

  const rhrValid = useMemo(
    () => data.filter((d): d is FitnessPoint & { rhrMA: number } => d.rhrMA !== null),
    [data],
  )
  const hrvValid = useMemo(
    () => data.filter((d): d is FitnessPoint & { hrvMA: number } => d.hrvMA !== null),
    [data],
  )
  const vo2Valid = useMemo(
    () => data.filter((d): d is FitnessPoint & { vo2max: number } => d.vo2max !== null),
    [data],
  )

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN_LOCAL.left} top={MARGIN_LOCAL.top}>
          <GridRows scale={leftScale} width={xMax} stroke={VX.grid} numTicks={5} />

          <LinePath<FitnessPoint & { rhrMA: number }>
            data={rhrValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => leftScale(d.rhrMA)}
            stroke={VX.series.restingHr}
            strokeWidth={2.5}
            curve={curveMonotoneX}
          />
          <LinePath<FitnessPoint & { hrvMA: number }>
            data={hrvValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => rightScale(d.hrvMA)}
            stroke={VX.series.hrv}
            strokeWidth={2.5}
            curve={curveMonotoneX}
          />

          {vo2Valid.map((d) => (
            <circle
              key={`vo2-${d.date}`}
              cx={xScale(d.date) ?? 0}
              cy={rightScale(d.vo2max)}
              r={5}
              fill={VX.series.vo2max}
              stroke={VX.dotStroke}
              strokeWidth={2}
            />
          ))}

          {syncedPoint &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
                  {syncedPoint.rhrMA !== null && (
                    <circle
                      cx={sx}
                      cy={leftScale(syncedPoint.rhrMA)}
                      r={4}
                      fill={VX.series.restingHr}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                  {syncedPoint.hrvMA !== null && (
                    <circle
                      cx={sx}
                      cy={rightScale(syncedPoint.hrvMA)}
                      r={4}
                      fill={VX.series.hrv}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                </>
              )
            })()}

          <AxisLeftNumeric
            scale={leftScale}
            numTicks={5}
            tickFormat={(v) => `${Math.round(Number(v))} bpm`}
          />
          <AxisRightNumeric
            scale={rightScale}
            left={xMax}
            numTicks={5}
            tickFormat={(v) => `${Math.round(Number(v))} ms`}
          />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />

          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {tip.data.rhrMA !== null && (
                <TooltipRow
                  color={VX.series.restingHr}
                  label="RHR (7d)"
                  value={`${Math.round(tip.data.rhrMA)} bpm`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.hrvMA !== null && (
                <TooltipRow
                  color={VX.series.hrv}
                  label="HRV (7d)"
                  value={`${Math.round(tip.data.hrvMA)} ms`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.vo2max !== null && (
                <TooltipRow
                  color={VX.series.vo2max}
                  label="VO2 Max"
                  value={tip.data.vo2max.toFixed(1)}
                  shape="dot"
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export function FitnessTrendChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildFitnessData(data), [data])
  const summary = useMemo(() => computeFitnessSummary(data), [data])

  const headerExtra = (
    <span style={{ fontSize: 12 }}>
      {summary.vo2max !== null && (
        <span style={{ marginRight: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: VX.series.vo2max }}>
            {summary.vo2max.toFixed(1)}
          </span>
          <span style={{ opacity: 0.5 }}> VO2</span>
        </span>
      )}
      {summary.rhrDelta !== null && (
        <span style={{ marginRight: 12 }}>
          <span
            style={{
              color: summary.rhrDelta <= 0 ? VX.goodSolid : VX.badSolid,
              fontWeight: 600,
            }}
          >
            {summary.rhrDelta > 0 ? '+' : ''}
            {summary.rhrDelta.toFixed(0)}
          </span>
          <span style={{ opacity: 0.5 }}> RHR</span>
        </span>
      )}
      {summary.hrvDelta !== null && (
        <span>
          <span
            style={{
              color: summary.hrvDelta >= 0 ? VX.goodSolid : VX.badSolid,
              fontWeight: 600,
            }}
          >
            {summary.hrvDelta > 0 ? '+' : ''}
            {summary.hrvDelta.toFixed(0)}
          </span>
          <span style={{ opacity: 0.5 }}> HRV</span>
        </span>
      )}
    </span>
  )

  return (
    <ChartCard title="Fitness Trends" tooltip={METRIC_TOOLTIPS.fitnessTrends} extra={headerExtra}>
      <div style={{ height: 300 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <FitnessTrendChartInner data={chartData} width={Math.max(width, 200)} height={300} />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          {
            key: 'rhr',
            label: 'RHR (7d avg) ↓ better',
            color: VX.series.restingHr,
            strokeWidth: 2.5,
          },
          {
            key: 'hrv',
            label: 'HRV (7d avg) ↑ better',
            color: VX.series.hrv,
            strokeWidth: 2.5,
          },
          { key: 'vo2', label: 'VO2 Max', color: VX.series.vo2max, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}
