import { Card, Tooltip as AntTooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useCallback, useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft } from '@visx/axis'
import { curveMonotoneX } from '@visx/curve'
import { localPoint } from '@visx/event'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scalePoint } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { Threshold } from '@visx/threshold'
import { useTooltip, TooltipWithBounds } from '@visx/tooltip'
import type { DailyMetric } from './types'
import { COLORS, METRIC_TOOLTIPS } from './constants'
import {
  acwrZoneColor,
  acwrZoneLabel,
  buildRecoveryTrendData,
  computeTrainingLoad,
  type TrainingLoadPoint,
} from './utils'

const MARGIN = { top: 12, right: 16, bottom: 30, left: 44 }
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function fmtDate(value: unknown): string {
  const s = String(value ?? '')
  // Extract YYYY-MM-DD if present anywhere in the string
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[3]}.${match[2]}`
  return s.length > 10 ? s.slice(0, 10) : s
}

function fmtTooltipDate(date: unknown): string {
  if (typeof date !== 'string') return String(date ?? '')
  const p = date.split('-')
  if (p.length !== 3) return date
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${DAYS[d.getDay()]} ${dd}.${mm}.${yy}`
}

function ChartTitle({ title, tooltip }: { title: string; tooltip: string }) {
  return (
    <span>
      {title}
      <AntTooltip title={tooltip} placement="right">
        <InfoCircleOutlined
          style={{ fontSize: 11, marginLeft: 6, color: 'rgba(128,128,128,0.45)', cursor: 'help' }}
        />
      </AntTooltip>
    </span>
  )
}

const tooltipStyles = {
  backgroundColor: 'rgba(0,0,0,0.88)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  lineHeight: '18px',
  color: 'rgba(255,255,255,0.85)',
  border: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
} as const

// ── ACWR Threshold Chart ─────────────────────────────────────────────────

function ACWRChartInner({
  data,
  width,
  height,
}: {
  data: TrainingLoadPoint[]
  width: number
  height: number
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, xMax],
        padding: 0.3,
      }),
    [data, xMax],
  )

  const acwrValues = data.map((d) => d.acwr).filter((v): v is number => v !== null)
  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, Math.max(2, ...acwrValues) * 1.1],
        range: [yMax, 0],
        nice: true,
      }),
    [acwrValues, yMax],
  )

  const { tooltipOpen, tooltipLeft, tooltipTop, tooltipData, showTooltip, hideTooltip } =
    useTooltip<TrainingLoadPoint>()

  const svgRef = useRef<SVGSVGElement>(null)

  const handleMouse = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const point = localPoint(svgRef.current!, event)
      if (!point) return
      const px = point.x - MARGIN.left
      let closest = data[0]!
      let minDist = Infinity
      for (const d of data) {
        const sx = xScale(d.date) ?? 0
        const dist = Math.abs(sx - px)
        if (dist < minDist) {
          minDist = dist
          closest = d
        }
      }
      showTooltip({
        tooltipData: closest,
        tooltipLeft: (xScale(closest.date) ?? 0) + MARGIN.left,
        tooltipTop: yScale(closest.acwr ?? 1) + MARGIN.top,
      })
    },
    [data, xScale, yScale, showTooltip],
  )

  const tickValues = data.length <= 10 ? data.map((d) => d.date) : undefined

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke="rgba(128,128,128,0.1)" numTicks={5} />

          {/* Threshold: red fill when ACWR > 1.3 (overtraining) */}
          <Threshold<TrainingLoadPoint>
            id="acwr-over"
            data={data.filter((d) => d.acwr !== null)}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScale(1.3)}
            y1={(d) => yScale(d.acwr!)}
            clipAboveTo={0}
            clipBelowTo={yMax}
            curve={curveMonotoneX}
            aboveAreaProps={{ fill: '#ff3d00', fillOpacity: 0.2 }}
            belowAreaProps={{ fill: 'transparent' }}
          />

          {/* Threshold: blue fill when ACWR < 0.8 (undertrained) */}
          <Threshold<TrainingLoadPoint>
            id="acwr-under"
            data={data.filter((d) => d.acwr !== null)}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScale(0.8)}
            y1={(d) => yScale(d.acwr!)}
            clipAboveTo={0}
            clipBelowTo={yMax}
            curve={curveMonotoneX}
            aboveAreaProps={{ fill: 'transparent' }}
            belowAreaProps={{ fill: '#2979ff', fillOpacity: 0.15 }}
          />

          {/* Optimal zone light background */}
          <rect
            x={0}
            y={yScale(1.3)}
            width={xMax}
            height={yScale(0.8) - yScale(1.3)}
            fill="#00c853"
            fillOpacity={0.04}
          />

          {/* Reference lines */}
          <line
            x1={0}
            x2={xMax}
            y1={yScale(0.8)}
            y2={yScale(0.8)}
            stroke="rgba(41,121,255,0.25)"
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScale(1.3)}
            y2={yScale(1.3)}
            stroke="rgba(0,200,83,0.25)"
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScale(1.5)}
            y2={yScale(1.5)}
            stroke="rgba(255,61,0,0.25)"
            strokeDasharray="4 4"
          />

          {/* ACWR line */}
          <LinePath<TrainingLoadPoint>
            data={data.filter((d) => d.acwr !== null)}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.acwr!)}
            stroke={COLORS.acwr}
            strokeWidth={2.5}
            curve={curveMonotoneX}
          />

          {/* Dots when few points */}
          {data.length < 15 &&
            data
              .filter((d) => d.acwr !== null)
              .map((d) => (
                <circle
                  key={d.date}
                  cx={xScale(d.date) ?? 0}
                  cy={yScale(d.acwr!)}
                  r={4}
                  fill={COLORS.acwr}
                />
              ))}

          {/* Crosshair */}
          {tooltipOpen && tooltipData && (
            <line
              x1={xScale(tooltipData.date) ?? 0}
              x2={xScale(tooltipData.date) ?? 0}
              y1={0}
              y2={yMax}
              stroke="rgba(255,255,255,0.2)"
              strokeDasharray="3 3"
            />
          )}

          <AxisLeft
            scale={yScale}
            numTicks={5}
            tickLabelProps={{ fill: 'rgba(128,128,128,0.65)', fontSize: 11, dx: -4 }}
            stroke="transparent"
            tickStroke="transparent"
          />
          <AxisBottom
            top={yMax}
            scale={xScale}
            tickValues={tickValues}
            tickFormat={fmtDate}
            tickLabelProps={{ fill: 'rgba(128,128,128,0.65)', fontSize: 10, textAnchor: 'middle' }}
            stroke="transparent"
            tickStroke="transparent"
          />

          {/* Hover area */}
          <rect
            width={xMax}
            height={yMax}
            fill="transparent"
            onMouseMove={handleMouse}
            onMouseLeave={hideTooltip}
          />
        </Group>
      </svg>
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={tooltipStyles}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
            {fmtTooltipDate(tooltipData.date)}
          </div>
          <div>
            <span style={{ fontWeight: 600, color: acwrZoneColor(tooltipData.zone) }}>
              {tooltipData.acwr?.toFixed(2)}
            </span>{' '}
            <span style={{ color: acwrZoneColor(tooltipData.zone), fontSize: 11 }}>
              {acwrZoneLabel(tooltipData.zone)}
            </span>
          </div>
        </TooltipWithBounds>
      )}
    </div>
  )
}

export function ACWRThresholdChart({ data }: { data: DailyMetric[] }) {
  const loadData = useMemo(() => computeTrainingLoad(data), [data])
  const latest = loadData[loadData.length - 1]

  return (
    <Card
      title={<ChartTitle title="Training Load (ACWR)" tooltip={METRIC_TOOLTIPS.trainingLoad} />}
      size="small"
      style={{ marginBottom: 16 }}
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
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <ACWRChartInner data={loadData} width={Math.max(width, 200)} height={280} />
          )}
        </ParentSize>
      </div>
    </Card>
  )
}

// ── Load Divergence Threshold Chart ─────────────────────────────────────

function DivergenceChartInner({
  data,
  width,
  height,
}: {
  data: TrainingLoadPoint[]
  width: number
  height: number
}) {
  const topH = Math.round(height * 0.6)
  const bottomH = height - topH
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

  const { tooltipOpen, tooltipLeft, tooltipData, showTooltip, hideTooltip } =
    useTooltip<TrainingLoadPoint>()

  const svgRef = useRef<SVGSVGElement>(null)

  const handleMouse = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const point = localPoint(svgRef.current!, event)
      if (!point) return
      const px = point.x - MARGIN.left
      let closest = data[0]!
      let minDist = Infinity
      for (const d of data) {
        const dist = Math.abs((xScale(d.date) ?? 0) - px)
        if (dist < minDist) {
          minDist = dist
          closest = d
        }
      }
      showTooltip({
        tooltipData: closest,
        tooltipLeft: (xScale(closest.date) ?? 0) + MARGIN.left,
      })
    },
    [data, xScale, showTooltip],
  )

  const tickValues = data.length <= 10 ? data.map((d) => d.date) : undefined

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} width={width} height={height}>
        {/* Top panel: signal lines */}
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScaleTop} width={xMax} stroke="rgba(128,128,128,0.1)" numTicks={4} />
          <LinePath<TrainingLoadPoint>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScaleTop(d.acute)}
            stroke={COLORS.acute}
            strokeWidth={2}
            curve={curveMonotoneX}
          />
          <LinePath<TrainingLoadPoint>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScaleTop(d.chronic)}
            stroke={COLORS.chronic}
            strokeWidth={2}
            curve={curveMonotoneX}
          />
          <AxisLeft
            scale={yScaleTop}
            numTicks={4}
            tickLabelProps={{ fill: 'rgba(128,128,128,0.65)', fontSize: 10, dx: -4 }}
            stroke="transparent"
            tickStroke="transparent"
          />
          <rect
            width={xMax}
            height={yMaxTop}
            fill="transparent"
            onMouseMove={handleMouse}
            onMouseLeave={hideTooltip}
          />
        </Group>

        {/* Bottom panel: divergence threshold */}
        <Group left={MARGIN.left} top={topH}>
          <GridRows scale={yScaleBottom} width={xMax} stroke="rgba(128,128,128,0.1)" numTicks={3} />
          <Threshold<TrainingLoadPoint>
            id="div-threshold"
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScaleBottom(0)}
            y1={(d) => yScaleBottom(d.divergence)}
            clipAboveTo={0}
            clipBelowTo={yMaxBottom}
            curve={curveMonotoneX}
            aboveAreaProps={{ fill: '#00c853', fillOpacity: 0.35 }}
            belowAreaProps={{ fill: '#ff3d00', fillOpacity: 0.35 }}
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScaleBottom(0)}
            y2={yScaleBottom(0)}
            stroke="rgba(128,128,128,0.3)"
          />
          <AxisLeft
            scale={yScaleBottom}
            numTicks={3}
            tickLabelProps={{ fill: 'rgba(128,128,128,0.65)', fontSize: 10, dx: -4 }}
            stroke="transparent"
            tickStroke="transparent"
          />
          <AxisBottom
            top={yMaxBottom}
            scale={xScale}
            tickValues={tickValues}
            tickFormat={fmtDate}
            tickLabelProps={{ fill: 'rgba(128,128,128,0.65)', fontSize: 10, textAnchor: 'middle' }}
            stroke="transparent"
            tickStroke="transparent"
          />
          <rect
            width={xMax}
            height={yMaxBottom}
            fill="transparent"
            onMouseMove={handleMouse}
            onMouseLeave={hideTooltip}
          />
        </Group>

        {/* Crosshair spanning both panels */}
        {tooltipOpen && tooltipData && (
          <line
            x1={(xScale(tooltipData.date) ?? 0) + MARGIN.left}
            x2={(xScale(tooltipData.date) ?? 0) + MARGIN.left}
            y1={MARGIN.top}
            y2={height - MARGIN.bottom}
            stroke="rgba(255,255,255,0.2)"
            strokeDasharray="3 3"
          />
        )}
      </svg>
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds left={tooltipLeft} top={topH} style={tooltipStyles}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
            {fmtTooltipDate(tooltipData.date)}
          </div>
          <div>
            <span style={{ color: COLORS.acute }}>Short {tooltipData.acute}</span>
            {' / '}
            <span style={{ color: COLORS.chronic }}>Long {tooltipData.chronic}</span>
          </div>
          <div style={{ color: tooltipData.divergence >= 0 ? '#00c853' : '#ff3d00' }}>
            {tooltipData.divergence >= 0 ? '+' : ''}
            {tooltipData.divergence.toFixed(1)} divergence
          </div>
        </TooltipWithBounds>
      )}
    </div>
  )
}

export function DivergenceThresholdChart({ data }: { data: DailyMetric[] }) {
  const loadData = useMemo(() => computeTrainingLoad(data), [data])

  return (
    <Card
      title={<ChartTitle title="Load Divergence" tooltip={METRIC_TOOLTIPS.loadBalance} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <DivergenceChartInner data={loadData} width={Math.max(width, 200)} height={280} />
          )}
        </ParentSize>
      </div>
    </Card>
  )
}

// ── Recovery Threshold Chart ────────────────────────────────────────────

type RecoveryPoint = {
  date: string
  recovery: number | null
  sleepScore: number | null
  bbHigh: number | null
}

function RecoveryChartInner({
  data,
  width,
  height,
}: {
  data: RecoveryPoint[]
  width: number
  height: number
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom
  const valid = data.filter((d) => d.recovery !== null) as (RecoveryPoint & { recovery: number })[]

  const xScale = useMemo(
    () => scalePoint<string>({ domain: valid.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [valid, xMax],
  )

  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, 100], range: [yMax, 0] }), [yMax])

  const { tooltipOpen, tooltipLeft, tooltipTop, tooltipData, showTooltip, hideTooltip } =
    useTooltip<RecoveryPoint & { recovery: number }>()

  const svgRef = useRef<SVGSVGElement>(null)

  const handleMouse = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const point = localPoint(svgRef.current!, event)
      if (!point) return
      const px = point.x - MARGIN.left
      let closest = valid[0]!
      let minDist = Infinity
      for (const d of valid) {
        const dist = Math.abs((xScale(d.date) ?? 0) - px)
        if (dist < minDist) {
          minDist = dist
          closest = d
        }
      }
      showTooltip({
        tooltipData: closest,
        tooltipLeft: (xScale(closest.date) ?? 0) + MARGIN.left,
        tooltipTop: yScale(closest.recovery) + MARGIN.top,
      })
    },
    [valid, xScale, yScale, showTooltip],
  )

  const tickValues = valid.length <= 10 ? valid.map((d) => d.date) : undefined

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke="rgba(128,128,128,0.1)" numTicks={5} />

          {/* Zone backgrounds */}
          <rect
            x={0}
            y={yScale(100)}
            width={xMax}
            height={yScale(70) - yScale(100)}
            fill="#00c853"
            fillOpacity={0.04}
          />
          <rect
            x={0}
            y={yScale(70)}
            width={xMax}
            height={yScale(40) - yScale(70)}
            fill="#ffd600"
            fillOpacity={0.04}
          />
          <rect
            x={0}
            y={yScale(40)}
            width={xMax}
            height={yScale(0) - yScale(40)}
            fill="#ff3d00"
            fillOpacity={0.04}
          />

          {/* Threshold at 70: green above, yellow/red below */}
          <Threshold<RecoveryPoint & { recovery: number }>
            id="recovery-push"
            data={valid}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScale(70)}
            y1={(d) => yScale(d.recovery)}
            clipAboveTo={0}
            clipBelowTo={yMax}
            curve={curveMonotoneX}
            aboveAreaProps={{ fill: '#00c853', fillOpacity: 0.25 }}
            belowAreaProps={{ fill: 'transparent' }}
          />

          {/* Threshold at 40: red below */}
          <Threshold<RecoveryPoint & { recovery: number }>
            id="recovery-rest"
            data={valid}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScale(40)}
            y1={(d) => yScale(d.recovery)}
            clipAboveTo={0}
            clipBelowTo={yMax}
            curve={curveMonotoneX}
            aboveAreaProps={{ fill: 'transparent' }}
            belowAreaProps={{ fill: '#ff3d00', fillOpacity: 0.25 }}
          />

          {/* Reference lines */}
          <line
            x1={0}
            x2={xMax}
            y1={yScale(70)}
            y2={yScale(70)}
            stroke="rgba(0,200,83,0.25)"
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScale(40)}
            y2={yScale(40)}
            stroke="rgba(255,61,0,0.25)"
            strokeDasharray="4 4"
          />

          {/* Recovery line */}
          <LinePath<RecoveryPoint & { recovery: number }>
            data={valid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.recovery)}
            stroke="#7c4dff"
            strokeWidth={2.5}
            curve={curveMonotoneX}
          />

          {valid.length < 15 &&
            valid.map((d) => (
              <circle
                key={d.date}
                cx={xScale(d.date) ?? 0}
                cy={yScale(d.recovery)}
                r={3.5}
                fill="#7c4dff"
              />
            ))}

          {/* Crosshair */}
          {tooltipOpen && tooltipData && (
            <line
              x1={xScale(tooltipData.date) ?? 0}
              x2={xScale(tooltipData.date) ?? 0}
              y1={0}
              y2={yMax}
              stroke="rgba(255,255,255,0.2)"
              strokeDasharray="3 3"
            />
          )}

          <AxisLeft
            scale={yScale}
            numTicks={5}
            tickLabelProps={{ fill: 'rgba(128,128,128,0.65)', fontSize: 11, dx: -4 }}
            stroke="transparent"
            tickStroke="transparent"
          />
          <AxisBottom
            top={yMax}
            scale={xScale}
            tickValues={tickValues}
            tickFormat={fmtDate}
            tickLabelProps={{ fill: 'rgba(128,128,128,0.65)', fontSize: 10, textAnchor: 'middle' }}
            stroke="transparent"
            tickStroke="transparent"
          />

          <rect
            width={xMax}
            height={yMax}
            fill="transparent"
            onMouseMove={handleMouse}
            onMouseLeave={hideTooltip}
          />
        </Group>
      </svg>
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={tooltipStyles}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
            {fmtTooltipDate(tooltipData.date)}
          </div>
          <div>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {Math.round(tooltipData.recovery)}
            </span>{' '}
            <span
              style={{
                fontSize: 11,
                color:
                  tooltipData.recovery >= 70
                    ? '#00c853'
                    : tooltipData.recovery >= 40
                      ? '#ffd600'
                      : '#ff3d00',
              }}
            >
              {tooltipData.recovery >= 70 ? 'Push' : tooltipData.recovery >= 40 ? 'Normal' : 'Rest'}
            </span>
          </div>
        </TooltipWithBounds>
      )}
    </div>
  )
}

export function RecoveryThresholdChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildRecoveryTrendData(data), [data])

  return (
    <Card
      title={<ChartTitle title="Recovery Trend" tooltip={METRIC_TOOLTIPS.recoveryScore} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <RecoveryChartInner data={chartData} width={Math.max(width, 200)} height={280} />
          )}
        </ParentSize>
      </div>
    </Card>
  )
}
