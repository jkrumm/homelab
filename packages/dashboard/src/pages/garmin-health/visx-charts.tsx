import { Card, Tooltip as AntTooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AxisBottom, AxisLeft } from '@visx/axis'
import { curveMonotoneX } from '@visx/curve'
import { localPoint } from '@visx/event'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scalePoint } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { Threshold } from '@visx/threshold'
import { HoverContext } from './hover-context'
import type { DailyMetric } from './types'
import { METRIC_TOOLTIPS, VX, useVxTheme } from './constants'
import {
  acwrZoneColor,
  acwrZoneLabel,
  buildRecoveryTrendData,
  computeTrainingLoad,
  type TrainingLoadPoint,
} from './utils'

const MARGIN = { top: 12, right: 16, bottom: 30, left: 44 }
const MIN_PX_PER_TICK = 55

/** Pick evenly-spaced tick values that fit the available width */
function smartTicks(dates: string[], xMax: number): string[] {
  if (dates.length === 0) return []
  const maxTicks = Math.max(2, Math.floor(xMax / MIN_PX_PER_TICK))
  if (dates.length <= maxTicks) return dates
  const step = Math.ceil(dates.length / maxTicks)
  return dates.filter((_, i) => i % step === 0 || i === dates.length - 1)
}

function fmtDate(value: unknown): string {
  if (value instanceof Date) {
    const dd = String(value.getDate()).padStart(2, '0')
    const mm = String(value.getMonth() + 1).padStart(2, '0')
    return `${dd}.${mm}`
  }
  const s = String(value ?? '')
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[3]}.${match[2]}`
  return s
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtTooltipDate(date: unknown): string {
  if (date instanceof Date) {
    return `${SHORT_DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`
  }
  const s = String(date ?? '')
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return s
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return `${SHORT_DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`
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

type LegendEntry = { key: string; label: string; color: string; secondColor?: string; strokeWidth?: number; shape?: 'line' | 'bar' | 'split' | 'splitLine' }

function ChartLegend({
  items,
  highlighted,
  onHighlight,
}: {
  items: LegendEntry[]
  highlighted: string | null
  onHighlight: (key: string | null) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 18, justifyContent: 'center', padding: '8px 0 2px', fontSize: 13 }}>
      {items.map((item) => (
        <div
          key={item.key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'default',
            opacity: highlighted === null || highlighted === item.key ? 1 : 0.3,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={() => onHighlight(item.key)}
          onMouseLeave={() => onHighlight(null)}
        >
          {item.shape === 'splitLine' ? (
            <svg width={20} height={14} style={{ flexShrink: 0 }}>
              <line x1={0} y1={7} x2={10} y2={7} stroke={item.color} strokeWidth={item.strokeWidth ?? 2.5} />
              <line x1={10} y1={7} x2={20} y2={7} stroke={item.secondColor} strokeWidth={item.strokeWidth ?? 2.5} />
            </svg>
          ) : item.shape === 'split' ? (
            <svg width={14} height={14} style={{ flexShrink: 0 }}>
              <defs>
                <clipPath id={`split-top-${item.key}`}><polygon points="0,0 14,0 0,14" /></clipPath>
                <clipPath id={`split-bot-${item.key}`}><polygon points="14,0 14,14 0,14" /></clipPath>
              </defs>
              <rect width={14} height={14} rx={2} fill={item.color} clipPath={`url(#split-top-${item.key})`} />
              <rect width={14} height={14} rx={2} fill={item.secondColor} clipPath={`url(#split-bot-${item.key})`} />
            </svg>
          ) : item.shape === 'bar' ? (
            <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: item.color, opacity: 0.7, flexShrink: 0 }} />
          ) : (
            <svg width={20} height={14} style={{ flexShrink: 0 }}>
              <line x1={0} y1={7} x2={20} y2={7} stroke={item.color} strokeWidth={item.strokeWidth ?? 2.5} />
            </svg>
          )}
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

function useTooltipStyles(): React.CSSProperties {
  const { tooltipBg, tooltipText, tooltipBorder, tooltipShadow } = useVxTheme()
  return useMemo(
    () => ({
      position: 'fixed' as const,
      pointerEvents: 'none' as const,
      zIndex: 9999,
      backgroundColor: tooltipBg,
      borderRadius: 6,
      padding: '0',
      fontSize: 12,
      lineHeight: '18px',
      color: tooltipText,
      border: tooltipBorder,
      boxShadow: tooltipShadow,
      minWidth: 140,
    }),
    [tooltipBg, tooltipText, tooltipBorder, tooltipShadow],
  )
}

type TooltipState<T> = { data: T; x: number; y: number } | null

function useChartTooltip<T>() {
  const [tip, setTip] = useState<TooltipState<T>>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const lastDateRef = useRef<string | null>(null)

  const show = useCallback((data: T, event: React.MouseEvent) => {
    setTip({ data, x: event.clientX + 12, y: event.clientY - 12 })
    // Move tooltip via DOM directly to avoid re-renders on every pixel
    if (tooltipRef.current) {
      tooltipRef.current.style.left = `${event.clientX + 12}px`
      tooltipRef.current.style.top = `${event.clientY - 12}px`
    }
  }, [])
  const hide = useCallback(() => {
    setTip(null)
    lastDateRef.current = null
  }, [])
  return { tip, show, hide, tooltipRef, lastDateRef }
}

function ChartTooltip({ tip, tooltipRef, styles, children }: { tip: { x: number; y: number } | null; tooltipRef?: React.RefObject<HTMLDivElement | null>; styles: React.CSSProperties; children: React.ReactNode }) {
  if (!tip) return null
  return (
    <div ref={tooltipRef} style={{ ...styles, left: tip.x, top: tip.y }}>
      {children}
    </div>
  )
}

function TooltipHeader({ date, label, labelColor }: { date: string; label?: string; labelColor?: string }) {
  const { tooltipMuted } = useVxTheme()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '6px 10px', borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
      <span style={{ fontSize: 11, color: tooltipMuted }}>{fmtTooltipDate(date)}</span>
      {label && <span style={{ fontSize: 11, fontWeight: 500, color: labelColor }}>{label}</span>}
    </div>
  )
}

function TooltipRow({ color, label, value, valueColor, shape, strokeWidth }: { color: string; label: string; value: string; valueColor?: string; shape?: 'dot' | 'line'; strokeWidth?: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '0 10px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {shape === 'line' ? (
          <svg width={12} height={10} style={{ flexShrink: 0 }}>
            <line x1={0} y1={5} x2={12} y2={5} stroke={color} strokeWidth={strokeWidth ?? 2} />
          </svg>
        ) : (
          <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color, flexShrink: 0 }} />
        )}
        {label}
      </span>
      <span style={{ fontWeight: 400, color: valueColor }}>{value}</span>
    </div>
  )
}

function TooltipBody({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '5px 0' }}>{children}</div>
}

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
  const { line, axis, axisStroke } = useVxTheme()
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

  const tooltipStyles = useTooltipStyles()
  const CHART_ID = 'acwr'
  const { date: hoveredDate, source: hoverSource, setHover } = useContext(HoverContext)
  const { tip, show, hide, tooltipRef, lastDateRef } = useChartTooltip<TrainingLoadPoint>()

  const handleMouse = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const point = localPoint(event)
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
      show(closest, event)
      if (lastDateRef.current !== closest.date) {
        lastDateRef.current = closest.date
        setHover(closest.date, CHART_ID)
      }
    },
    [data, xScale, show, setHover, lastDateRef],
  )

  const handleLeave = useCallback(() => {
    hide()
    setHover(null, null)
  }, [hide, setHover])

  const syncedPoint = hoveredDate ? data.find((d) => d.date === hoveredDate) : null
  const isDirectHover = hoverSource === CHART_ID

  const tickValues = useMemo(() => smartTicks(data.map((d) => d.date), xMax), [data, xMax])

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {/* Threshold: red fill when ACWR > 1.3 */}
          <Threshold<TrainingLoadPoint>
            id="acwr-over"
            data={data.filter((d) => d.acwr !== null)}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScale(1.3)}
            y1={(d) => yScale(d.acwr!)}
            clipAboveTo={0}
            clipBelowTo={yMax}
            curve={curveMonotoneX}
            belowAreaProps={{ fill: VX.bad }}
            aboveAreaProps={{ fill: 'transparent' }}
          />

          {/* Threshold: warn fill when ACWR < 0.8 */}
          <Threshold<TrainingLoadPoint>
            id="acwr-under"
            data={data.filter((d) => d.acwr !== null)}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScale(0.8)}
            y1={(d) => yScale(d.acwr!)}
            clipAboveTo={0}
            clipBelowTo={yMax}
            curve={curveMonotoneX}
            belowAreaProps={{ fill: 'transparent' }}
            aboveAreaProps={{ fill: VX.warn }}
          />

          {/* Optimal zone background — clipped to data range */}
          {data.length >= 2 && (() => {
            const x0 = xScale(data[0]!.date) ?? 0
            const x1 = xScale(data[data.length - 1]!.date) ?? 0
            return <rect x={x0} y={yScale(1.3)} width={x1 - x0} height={yScale(0.8) - yScale(1.3)} fill={VX.good} />
          })()}

          {/* Reference lines */}
          <line x1={0} x2={xMax} y1={yScale(0.8)} y2={yScale(0.8)} stroke={VX.warnRef} strokeDasharray="4 4" />
          <line x1={0} x2={xMax} y1={yScale(1.3)} y2={yScale(1.3)} stroke={VX.goodRef} strokeDasharray="4 4" />
          <line x1={0} x2={xMax} y1={yScale(1.5)} y2={yScale(1.5)} stroke={VX.badRef} strokeDasharray="4 4" />

          {/* ACWR line */}
          <LinePath<TrainingLoadPoint>
            data={data.filter((d) => d.acwr !== null)}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.acwr!)}
            stroke={line}
            strokeWidth={VX.lineWidth}
            curve={curveMonotoneX}
          />

          {/* Crosshair + hover dot */}
          {syncedPoint && syncedPoint.acwr !== null && (
            <>
              <line x1={xScale(syncedPoint.date) ?? 0} x2={xScale(syncedPoint.date) ?? 0} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
              <circle cx={xScale(syncedPoint.date) ?? 0} cy={yScale(syncedPoint.acwr)} r={VX.dotR} fill={line} stroke={VX.dotStroke} strokeWidth={2} />
            </>
          )}

          <AxisLeft scale={yScale} numTicks={5} tickLabelProps={{ fill: axis, fontSize: VX.axisFont, dx: -4 }} stroke={axisStroke} tickStroke={axisStroke} />
          <AxisBottom top={yMax} scale={xScale} tickValues={tickValues} tickFormat={fmtDate} tickLabelProps={{ fill: axis, fontSize: VX.axisFont, textAnchor: 'middle' }} stroke={axisStroke} tickStroke={axisStroke} />

          {/* Hover area */}
          <rect
            width={xMax}
            height={yMax}
            fill="transparent"
            onMouseMove={handleMouse}
            onMouseLeave={handleLeave}
          />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} label={acwrZoneLabel(tip.data.zone)} labelColor={acwrZoneColor(tip.data.zone)} />
            <TooltipBody>
              <TooltipRow color={line} label="ACWR" value={tip.data.acwr?.toFixed(2) ?? '–'} shape="line" />
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export function ACWRThresholdChart({ data }: { data: DailyMetric[] }) {
  const { line } = useVxTheme()
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
      <div style={{ height: 260 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <ACWRChartInner data={loadData} width={Math.max(width, 200)} height={260} />
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
    </Card>
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
  const { axis, axisStroke } = useVxTheme()
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
  const CHART_ID = 'divergence'
  const { date: hoveredDate, source: hoverSource, setHover } = useContext(HoverContext)
  const { tip, show, hide, tooltipRef, lastDateRef } = useChartTooltip<TrainingLoadPoint>()

  const handleMouse = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const point = localPoint(event)
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
      show(closest, event)
      if (lastDateRef.current !== closest.date) {
        lastDateRef.current = closest.date
        setHover(closest.date, CHART_ID)
      }
    },
    [data, xScale, show, setHover, lastDateRef],
  )

  const handleLeave = useCallback(() => {
    hide()
    setHover(null, null)
  }, [hide, setHover])

  const syncedPoint = hoveredDate ? data.find((d) => d.date === hoveredDate) : null
  const isDirectHover = hoverSource === CHART_ID

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
          <AxisLeft scale={yScaleTop} numTicks={4} tickLabelProps={{ fill: axis, fontSize: VX.axisFont, dx: -4 }} stroke={axisStroke} tickStroke={axisStroke} />
          <rect
            width={xMax}
            height={yMaxTop}
            fill="transparent"
            onMouseMove={handleMouse}
            onMouseLeave={handleLeave}
          />
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
          <AxisLeft scale={yScaleBottom} numTicks={3} tickLabelProps={{ fill: axis, fontSize: VX.axisFont, dx: -4 }} stroke={axisStroke} tickStroke={axisStroke} />
          <AxisBottom top={yMaxBottom} scale={xScale} tickValues={tickValues} tickFormat={fmtDate} tickLabelProps={{ fill: axis, fontSize: VX.axisFont, textAnchor: 'middle' }} stroke={axisStroke} tickStroke={axisStroke} />
          <rect
            width={xMax}
            height={yMaxBottom}
            fill="transparent"
            onMouseMove={handleMouse}
            onMouseLeave={handleLeave}
          />
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
    <Card
      title={<ChartTitle title="Load Divergence" tooltip={METRIC_TOOLTIPS.loadBalance} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
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
  const { line, axis, axisStroke } = useVxTheme()
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom
  const valid = data.filter((d) => d.recovery !== null) as (RecoveryPoint & { recovery: number })[]


  const xScale = useMemo(
    () => scalePoint<string>({ domain: valid.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [valid, xMax],
  )

  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, 100], range: [yMax, 0] }), [yMax])

  const tooltipStyles = useTooltipStyles()
  const CHART_ID = 'recovery'
  const { date: hoveredDate, source: hoverSource, setHover } = useContext(HoverContext)
  const { tip, show, hide, tooltipRef, lastDateRef } = useChartTooltip<RecoveryPoint & { recovery: number }>()

  const handleMouse = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const point = localPoint(event)
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
      show(closest, event)
      if (lastDateRef.current !== closest.date) {
        lastDateRef.current = closest.date
        setHover(closest.date, CHART_ID)
      }
    },
    [valid, xScale, show, setHover, lastDateRef],
  )

  const handleLeave = useCallback(() => {
    hide()
    setHover(null, null)
  }, [hide, setHover])

  const syncedPoint = hoveredDate ? valid.find((d) => d.date === hoveredDate) : null
  const isDirectHover = hoverSource === CHART_ID

  const tickValues = useMemo(() => smartTicks(valid.map((d) => d.date), xMax), [valid, xMax])

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {/* Zone backgrounds — clipped to data range */}
          {valid.length >= 2 && (() => {
            const x0 = xScale(valid[0]!.date) ?? 0
            const x1 = xScale(valid[valid.length - 1]!.date) ?? 0
            const w = x1 - x0
            return (
              <>
                <rect x={x0} y={yScale(100)} width={w} height={yScale(70) - yScale(100)} fill={VX.good} />
                <rect x={x0} y={yScale(70)} width={w} height={yScale(40) - yScale(70)} fill={VX.warn} />
                <rect x={x0} y={yScale(40)} width={w} height={yScale(0) - yScale(40)} fill={VX.bad} />
              </>
            )
          })()}

          {/* Threshold at 70: green when recovery > 70 */}
          <Threshold<RecoveryPoint & { recovery: number }>
            id="recovery-push"
            data={valid}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScale(70)}
            y1={(d) => yScale(d.recovery)}
            clipAboveTo={0}
            clipBelowTo={yMax}
            curve={curveMonotoneX}
            belowAreaProps={{ fill: VX.good }}
            aboveAreaProps={{ fill: 'transparent' }}
          />

          {/* Threshold at 40: red when recovery < 40 */}
          <Threshold<RecoveryPoint & { recovery: number }>
            id="recovery-rest"
            data={valid}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScale(40)}
            y1={(d) => yScale(d.recovery)}
            clipAboveTo={0}
            clipBelowTo={yMax}
            curve={curveMonotoneX}
            belowAreaProps={{ fill: 'transparent' }}
            aboveAreaProps={{ fill: VX.bad }}
          />

          {/* Reference lines */}
          <line x1={0} x2={xMax} y1={yScale(70)} y2={yScale(70)} stroke={VX.goodRef} strokeDasharray="4 4" />
          <line x1={0} x2={xMax} y1={yScale(40)} y2={yScale(40)} stroke={VX.badRef} strokeDasharray="4 4" />

          {/* Recovery line */}
          <LinePath<RecoveryPoint & { recovery: number }>
            data={valid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.recovery)}
            stroke={line}
            strokeWidth={VX.lineWidth}
            curve={curveMonotoneX}
          />

          {/* Crosshair + hover dot */}
          {syncedPoint && (
            <>
              <line x1={xScale(syncedPoint.date) ?? 0} x2={xScale(syncedPoint.date) ?? 0} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
              <circle cx={xScale(syncedPoint.date) ?? 0} cy={yScale(syncedPoint.recovery)} r={VX.dotR} fill={line} stroke={VX.dotStroke} strokeWidth={2} />
            </>
          )}

          <AxisLeft scale={yScale} numTicks={5} tickLabelProps={{ fill: axis, fontSize: VX.axisFont, dx: -4 }} stroke={axisStroke} tickStroke={axisStroke} />
          <AxisBottom top={yMax} scale={xScale} tickValues={tickValues} tickFormat={fmtDate} tickLabelProps={{ fill: axis, fontSize: VX.axisFont, textAnchor: 'middle' }} stroke={axisStroke} tickStroke={axisStroke} />

          <rect
            width={xMax}
            height={yMax}
            fill="transparent"
            onMouseMove={handleMouse}
            onMouseLeave={handleLeave}
          />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (() => {
          const zoneColor = tip.data.recovery >= 70 ? VX.goodSolid : tip.data.recovery >= 40 ? VX.warnSolid : VX.badSolid
          const zoneLabel = tip.data.recovery >= 70 ? 'Push' : tip.data.recovery >= 40 ? 'Normal' : 'Rest'
          return (
            <>
              <TooltipHeader date={tip.data.date} label={zoneLabel} labelColor={zoneColor} />
              <TooltipBody>
                <TooltipRow color={line} label="Recovery" value={String(Math.round(tip.data.recovery))} shape="line" />
              </TooltipBody>
            </>
          )
        })()}
      </ChartTooltip>
    </div>
  )
}

export function RecoveryThresholdChart({ data }: { data: DailyMetric[] }) {
  const { line } = useVxTheme()
  const chartData = useMemo(() => buildRecoveryTrendData(data), [data])

  return (
    <Card
      title={<ChartTitle title="Recovery Trend" tooltip={METRIC_TOOLTIPS.recoveryScore} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <div style={{ height: 260 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <RecoveryChartInner data={chartData} width={Math.max(width, 200)} height={260} />
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
    </Card>
  )
}
