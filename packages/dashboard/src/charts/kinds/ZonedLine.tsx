import { curveMonotoneX } from '@visx/curve'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { scaleLinear, scalePoint } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { Threshold } from '@visx/threshold'
import { useMemo, type ReactNode } from 'react'
import { AxisBottomDate, AxisLeftNumeric } from '../primitives/Axes'
import {
  ChartTooltip,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  useTooltipStyles,
} from '../primitives/ChartTooltip'
import { HoverOverlay } from '../primitives/HoverOverlay'
import { useHoverSync } from '../hooks/useHoverSync'
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
  /**
   * When yDomain is 'auto': the upper bound is at least this value (caps data max).
   * e.g. yAutoMaxFloor=2 guarantees the y-axis always reaches 2 even if data is smaller.
   */
  yAutoMaxFloor?: number
  /**
   * When yDomain is 'auto': the lower bound is at most this value.
   * Default 0 — always includes zero when data is all positive. Pass a negative
   * number (or Infinity to disable) for metrics that can legitimately swing both ways.
   */
  yAutoMinCeil?: number
  /** Padding multiplier applied to auto-computed bounds (away from zero). Default 1.1. */
  yAutoPad?: number
  zones?: ZonedLineZone[]
  thresholds?: ZonedLineThreshold[]
  refLines?: ZonedLineRefLine[]
  numTicksY?: number
  numTicksX?: number
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
 *
 * X-axis is built from the full `data` array so the calendar is preserved even
 * when the series has nulls; the line itself skips null points (creating
 * visual gaps).
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
    yAutoMaxFloor,
    yAutoMinCeil = 0,
    zones = [],
    thresholds = [],
    refLines = [],
    numTicksY = 5,
    numTicksX,
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
        // Full calendar — axis does not compress across nulls.
        domain: data.map(getX),
        range: [0, xMax],
        padding: 0.3,
      }),
    [data, xMax, getX],
  )

  const yScale = useMemo(() => {
    if (yDomain === 'auto') {
      const ys = valid.map((d) => d.__y)
      const dataMax = ys.length ? Math.max(...ys) : 0
      const dataMin = ys.length ? Math.min(...ys) : 0
      const upper = Math.max(dataMax, yAutoMaxFloor ?? dataMax) * yAutoPad
      const lower = Math.min(dataMin, yAutoMinCeil) * yAutoPad
      return scaleLinear<number>({ domain: [lower, upper], range: [yMax, 0], nice: true })
    }
    return scaleLinear<number>({ domain: yDomain, range: [yMax, 0] })
  }, [valid, yDomain, yMax, yAutoPad, yAutoMaxFloor, yAutoMinCeil])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } = useHoverSync<
    Valid
  >({
    data: valid,
    chartId,
    getX,
    xScale,
    marginLeft: MARGIN.left,
  })

  const tickValues = useMemo(
    () => (numTicksX ? smartTicksEvery(data.map(getX), numTicksX) : smartTicks(data.map(getX), xMax)),
    [data, xMax, getX, numTicksX],
  )

  const zoneRect =
    data.length >= 2
      ? (() => {
          const x0 = xScale(getX(data[0]!)) ?? 0
          const x1 = xScale(getX(data[data.length - 1]!)) ?? 0
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

/** Variant of smartTicks that targets an exact tick count rather than deriving from width. */
function smartTicksEvery(dates: string[], count: number): string[] {
  if (dates.length === 0) return []
  if (dates.length <= count) return dates
  const step = Math.ceil(dates.length / count)
  return dates.filter((_, i) => i % step === 0 || i === dates.length - 1)
}
