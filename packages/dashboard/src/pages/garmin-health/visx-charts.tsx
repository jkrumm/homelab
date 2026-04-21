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
  acwrZoneColor,
  acwrZoneLabel,
  buildRecoveryTrendData,
  computeTrainingLoad,
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
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } = useHoverSync<
    TrainingLoadPoint
  >({
    data,
    chartId: 'divergence',
    getX: (d) => d.date,
    xScale,
    marginLeft: MARGIN.left,
  })

  const tickValues = useMemo(() => smartTicks(data.map((d) => d.date), xMax), [data, xMax])

  const acuteOpa = highlighted === null || highlighted === 'acute' ? 0.7 : 0.1
  const chronicOpa = highlighted === null || highlighted === 'chronic' ? 0.85 : 0.1

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        {/* Top panel: signal lines with threshold fill between them */}
        <Group left={MARGIN.left} top={MARGIN.top}>
          <defs>
            <clipPath id="div-clip-above-chronic"><path d={clipAboveChronic} /></clipPath>
            <clipPath id="div-clip-below-chronic"><path d={clipBelowChronic} /></clipPath>
            <clipPath id="div-clip-above-acute"><path d={clipAboveAcute} /></clipPath>
            <clipPath id="div-clip-below-acute"><path d={clipBelowAcute} /></clipPath>
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
            <LinePath<TrainingLoadPoint> data={data} x={(d) => xScale(d.date) ?? 0} y={(d) => yScaleTop(d.acute)} stroke={VX.goodSolid} strokeWidth={2} strokeOpacity={acuteOpa} curve={curveMonotoneX} />
          </g>
          <g clipPath="url(#div-clip-below-chronic)">
            <LinePath<TrainingLoadPoint> data={data} x={(d) => xScale(d.date) ?? 0} y={(d) => yScaleTop(d.acute)} stroke={VX.badSolid} strokeWidth={2} strokeOpacity={acuteOpa} curve={curveMonotoneX} />
          </g>

          {/* Long-term (chronic): green when acute above, red when acute below — thicker, more opacity */}
          <g clipPath="url(#div-clip-below-acute)">
            <LinePath<TrainingLoadPoint> data={data} x={(d) => xScale(d.date) ?? 0} y={(d) => yScaleTop(d.chronic)} stroke={VX.goodSolid} strokeWidth={2.5} strokeOpacity={chronicOpa} curve={curveMonotoneX} />
          </g>
          <g clipPath="url(#div-clip-above-acute)">
            <LinePath<TrainingLoadPoint> data={data} x={(d) => xScale(d.date) ?? 0} y={(d) => yScaleTop(d.chronic)} stroke={VX.badSolid} strokeWidth={2.5} strokeOpacity={chronicOpa} curve={curveMonotoneX} />
          </g>

          {syncedPoint && (() => {
            const bothColor = syncedPoint.acute >= syncedPoint.chronic ? VX.goodSolid : VX.badSolid
            return (
              <>
                <line x1={xScale(syncedPoint.date) ?? 0} x2={xScale(syncedPoint.date) ?? 0} y1={0} y2={yMaxTop} stroke={VX.crosshair} strokeWidth={1} />
                <circle cx={xScale(syncedPoint.date) ?? 0} cy={yScaleTop(syncedPoint.acute)} r={4} fill={bothColor} stroke={VX.dotStroke} strokeWidth={2} />
                <circle cx={xScale(syncedPoint.date) ?? 0} cy={yScaleTop(syncedPoint.chronic)} r={4} fill={bothColor} stroke={VX.dotStroke} strokeWidth={2} />
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
            const barWidth = Math.max(xMax / data.length * 0.6, 2)
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
          <line
            x1={0}
            x2={xMax}
            y1={yScaleBottom(0)}
            y2={yScaleBottom(0)}
            stroke={VX.grid}
          />
          {syncedPoint && (
            <line x1={xScale(syncedPoint.date) ?? 0} x2={xScale(syncedPoint.date) ?? 0} y1={0} y2={yMaxBottom} stroke={VX.crosshair} strokeWidth={1} />
          )}
          <AxisLeftNumeric scale={yScaleBottom} numTicks={3} />
          <AxisBottomDate top={yMaxBottom} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMaxBottom} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (() => {
          const bothColor = tip.data.acute >= tip.data.chronic ? VX.goodSolid : VX.badSolid
          const divColor = tip.data.divergence >= 0 ? VX.goodSolid : VX.badSolid
          const divLabel = `${tip.data.divergence >= 0 ? '+' : ''}${tip.data.divergence.toFixed(1)}`
          return (
            <>
              <TooltipHeader date={tip.data.date} label={divLabel} labelColor={divColor} />
              <TooltipBody>
                <TooltipRow color={bothColor} label="Short" value={String(tip.data.acute)} shape="line" strokeWidth={2} />
                <TooltipRow color={bothColor} label="Long" value={String(tip.data.chronic)} shape="line" strokeWidth={2.5} />
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
            <DivergenceChartInner data={loadData} width={Math.max(width, 200)} height={260} highlighted={highlighted} />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'acute', label: 'Short-term (7d)', color: VX.goodSolid, secondColor: VX.badSolid, strokeWidth: 2, shape: 'splitLine' },
          { key: 'chronic', label: 'Long-term (28d)', color: VX.goodSolid, secondColor: VX.badSolid, strokeWidth: 3, shape: 'splitLine' },
          { key: 'divergence', label: 'Divergence', color: VX.goodSolid, secondColor: VX.badSolid, shape: 'split' },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
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
