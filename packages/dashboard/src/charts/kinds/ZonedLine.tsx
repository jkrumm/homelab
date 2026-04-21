import { curveMonotoneX } from '@visx/curve'
import { localPoint } from '@visx/event'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { scaleLinear, scalePoint } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { Threshold } from '@visx/threshold'
import { useCallback, useContext, useMemo, type ReactNode } from 'react'
import { HoverContext } from '../hover-context'
import { AxisBottomDate, AxisLeftNumeric } from '../primitives/Axes'
import {
  ChartTooltip,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  useTooltipStyles,
} from '../primitives/ChartTooltip'
import { HoverOverlay } from '../primitives/HoverOverlay'
import { useChartTooltip } from '../hooks/useChartTooltip'
import { useVxTheme } from '../theme'
import { VX } from '../tokens'
import { smartTicks } from '../utils/ticks'

export type ZonedLineZone = {
  from: number
  to: number
  fill: string
}

/** Semi-transparent fill above (or below) a threshold value, tracking the line. */
export type ZonedLineThreshold = {
  value: number
  side: 'above' | 'below'
  fill: string
}

/** Dashed horizontal reference line — visual annotation only, no fill. */
export type ZonedLineRefLine = {
  value: number
  color: string
  dashed?: boolean
}

export type ZonedLineTooltipLabel = {
  text: string
  color: string
}

export type ZonedLineProps<T> = {
  data: T[]
  width: number
  height: number
  chartId: string
  /** Extracts the x-axis category (date string) from a data point. */
  getX: (d: T) => string
  /** Extracts the y value — return null to exclude the point from the line and tooltip. */
  getY: (d: T) => number | null
  /** Fixed y-domain (e.g. [0, 100]) or 'auto' to compute from data. */
  yDomain: [number, number] | 'auto'
  /** Padding multiplier applied when yDomain is 'auto'. Default 1.1. */
  yAutoPad?: number
  /** Minimum upper bound when yDomain is 'auto'. */
  yAutoMin?: number
  zones?: ZonedLineZone[]
  thresholds?: ZonedLineThreshold[]
  refLines?: ZonedLineRefLine[]
  numTicksY?: number
  /** Label shown at the right of the tooltip header (e.g. zone name with zone color). */
  tooltipLabel?: (d: T) => ZonedLineTooltipLabel | null
  /** Row label in the tooltip body (e.g. "ACWR", "Recovery"). */
  seriesLabel: string
  /** Formatter for the tooltip value. */
  formatValue: (v: number) => string
  /** Optional extra tooltip rows (rendered after the main row). */
  renderExtraTooltipRows?: (d: T) => ReactNode
}

/**
 * Line chart with zone backgrounds, threshold fills, reference lines, and a
 * shared-cursor tooltip. Covers the ACWR / Recovery pattern. Does NOT handle
 * dual-panel charts (keep those bespoke).
 */
export function ZonedLine<T>(props: ZonedLineProps<T>) {
  const {
    data,
    width,
    height,
    chartId,
    getX,
    getY,
    yDomain,
    yAutoPad = 1.1,
    yAutoMin = 0,
    zones = [],
    thresholds = [],
    refLines = [],
    numTicksY = 5,
    tooltipLabel,
    seriesLabel,
    formatValue,
    renderExtraTooltipRows,
  } = props

  const { line } = useVxTheme()
  const MARGIN = VX.margin
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  type Valid = T & { __y: number }
  const valid = useMemo<Valid[]>(() => {
    const out: Valid[] = []
    for (const d of data) {
      const y = getY(d)
      if (y !== null && y !== undefined && !Number.isNaN(y)) {
        out.push(Object.assign({}, d, { __y: y }) as Valid)
      }
    }
    return out
  }, [data, getY])

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: valid.map(getX),
        range: [0, xMax],
        padding: 0.3,
      }),
    [valid, xMax, getX],
  )

  const yScale = useMemo(() => {
    if (yDomain === 'auto') {
      const max = Math.max(yAutoMin, ...valid.map((d) => d.__y)) * yAutoPad
      return scaleLinear<number>({ domain: [0, max], range: [yMax, 0], nice: true })
    }
    return scaleLinear<number>({ domain: yDomain, range: [yMax, 0] })
  }, [valid, yDomain, yMax, yAutoPad, yAutoMin])

  const tooltipStyles = useTooltipStyles()
  const { date: hoveredDate, source: hoverSource, setHover } = useContext(HoverContext)
  const { tip, show, hide, tooltipRef, lastDateRef } = useChartTooltip<Valid>()

  const handleMouse = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const point = localPoint(event)
      if (!point || valid.length === 0) return
      const px = point.x - MARGIN.left
      let closest = valid[0]!
      let minDist = Infinity
      for (const d of valid) {
        const sx = xScale(getX(d)) ?? 0
        const dist = Math.abs(sx - px)
        if (dist < minDist) {
          minDist = dist
          closest = d
        }
      }
      show(closest, event)
      const date = getX(closest)
      if (lastDateRef.current !== date) {
        lastDateRef.current = date
        setHover(date, chartId)
      }
    },
    [valid, xScale, show, setHover, lastDateRef, getX, chartId, MARGIN.left],
  )

  const handleLeave = useCallback(() => {
    hide()
    setHover(null, null)
  }, [hide, setHover])

  const syncedPoint = hoveredDate ? valid.find((d) => getX(d) === hoveredDate) : null
  const isDirectHover = hoverSource === chartId
  const tickValues = useMemo(() => smartTicks(valid.map(getX), xMax), [valid, xMax, getX])

  const zoneRect =
    valid.length >= 2
      ? (() => {
          const x0 = xScale(getX(valid[0]!)) ?? 0
          const x1 = xScale(getX(valid[valid.length - 1]!)) ?? 0
          return { x0, width: x1 - x0 }
        })()
      : null

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={numTicksY} />

          {zoneRect &&
            zones.map((z, i) => (
              <rect
                key={`zone-${i}`}
                x={zoneRect.x0}
                y={yScale(z.to)}
                width={zoneRect.width}
                height={yScale(z.from) - yScale(z.to)}
                fill={z.fill}
              />
            ))}

          {thresholds.map((t, i) => (
            <Threshold<Valid>
              key={`thr-${i}`}
              id={`${chartId}-thr-${i}`}
              data={valid}
              x={(d) => xScale(getX(d)) ?? 0}
              y0={() => yScale(t.value)}
              y1={(d) => yScale(d.__y)}
              clipAboveTo={0}
              clipBelowTo={yMax}
              curve={curveMonotoneX}
              belowAreaProps={{ fill: t.side === 'above' ? t.fill : 'transparent' }}
              aboveAreaProps={{ fill: t.side === 'below' ? t.fill : 'transparent' }}
            />
          ))}

          {refLines.map((r, i) => (
            <line
              key={`ref-${i}`}
              x1={0}
              x2={xMax}
              y1={yScale(r.value)}
              y2={yScale(r.value)}
              stroke={r.color}
              strokeDasharray={r.dashed === false ? undefined : '4 4'}
            />
          ))}

          <LinePath<Valid>
            data={valid}
            x={(d) => xScale(getX(d)) ?? 0}
            y={(d) => yScale(d.__y)}
            stroke={line}
            strokeWidth={VX.lineWidth}
            curve={curveMonotoneX}
          />

          {syncedPoint && (
            <>
              <line
                x1={xScale(getX(syncedPoint)) ?? 0}
                x2={xScale(getX(syncedPoint)) ?? 0}
                y1={0}
                y2={yMax}
                stroke={VX.crosshair}
                strokeWidth={1}
              />
              <circle
                cx={xScale(getX(syncedPoint)) ?? 0}
                cy={yScale(syncedPoint.__y)}
                r={VX.dotR}
                fill={line}
                stroke={VX.dotStroke}
                strokeWidth={2}
              />
            </>
          )}

          <AxisLeftNumeric scale={yScale} numTicks={numTicksY} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />

          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip
        tip={isDirectHover ? tip : null}
        tooltipRef={tooltipRef}
        styles={tooltipStyles}
      >
        {tip && isDirectHover && (
          <>
            <TooltipHeader
              date={getX(tip.data)}
              label={tooltipLabel?.(tip.data)?.text}
              labelColor={tooltipLabel?.(tip.data)?.color}
            />
            <TooltipBody>
              <TooltipRow
                color={line}
                label={seriesLabel}
                value={formatValue(tip.data.__y)}
                shape="line"
              />
              {renderExtraTooltipRows?.(tip.data)}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}
