import { useMemo, useState } from 'react'
import { curveMonotoneX } from '@visx/curve'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scalePoint } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { Threshold } from '@visx/threshold'
import type { DailyMetric, GarminActivity } from './types'
import { METRIC_TOOLTIPS, activityLegendTypes, activityTypeMeta, scoreColor } from './constants'
import {
  AxisBottomDate,
  AxisLeftNumeric,
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
  buildActivityBuckets,
  buildActivityData,
  buildBodyBatteryData,
  buildFitnessData,
  buildRecoveryTrendData,
  buildSleepChartData,
  buildStressData,
  computeFitnessSummary,
  computeTrainingLoad,
  formatHoursMin,
  sleepScoreLabel,
  type ActivityDayBucket,
  type TrainingLoadPoint,
} from './utils'

const MARGIN = VX.margin

// ── Activity Stack Chart (per-day workouts, color = type, height = duration) ──

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function ActivityStackInner({
  buckets,
  width,
  height,
}: {
  buckets: ActivityDayBucket[]
  width: number
  height: number
}) {
  const { line, axis: axisColor, tooltipMuted } = useVxTheme()
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: buckets.map((b) => b.date),
        range: [0, xMax],
        padding: 0.5,
      }),
    [buckets, xMax],
  )

  const yMaxValue = useMemo(() => {
    const maxDur = buckets.reduce((m, b) => Math.max(m, b.totalDurationMin), 0)
    // Round up to a clean tick — 30-min steps for low totals, 60-min for higher.
    const step = maxDur > 120 ? 60 : 30
    return Math.max(step, Math.ceil(maxDur / step) * step)
  }, [buckets])

  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, yMaxValue], range: [yMax, 0], nice: true }),
    [yMaxValue, yMax],
  )

  const slotWidth = buckets.length > 1 ? xMax / (buckets.length - 1) : xMax
  const barWidth = Math.max(Math.min(slotWidth * 0.7, 22), 3)

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<ActivityDayBucket>({
      data: buckets,
      chartId: 'activities',
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = useMemo(
    () => smartTicks(buckets.map((b) => b.date), xMax),
    [buckets, xMax],
  )

  const hoveredX = syncedPoint ? (xScale(syncedPoint.date) ?? null) : null

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows
            scale={yScale}
            width={xMax}
            stroke={VX.grid}
            strokeWidth={1}
            numTicks={4}
            pointerEvents="none"
          />

          {/* Stacked bars, one column per day, segments earliest → latest (bottom → top) */}
          {buckets.map((bucket) => {
            const x = xScale(bucket.date) ?? 0
            let cumMin = 0
            return bucket.activities.map((a) => {
              const durMin = (a.duration_sec ?? 0) / 60
              if (durMin <= 0) return null
              const yTop = yScale(cumMin + durMin)
              const yBottom = yScale(cumMin)
              cumMin += durMin
              const meta = activityTypeMeta(a.type_key)
              return (
                <rect
                  key={a.activity_id}
                  x={x - barWidth / 2}
                  y={yTop}
                  width={barWidth}
                  height={Math.max(1, yBottom - yTop)}
                  fill={meta.color}
                  opacity={0.88}
                />
              )
            })
          })}

          {/* Ghost crosshair when another chart is hovered */}
          {hoveredX !== null && !isDirectHover && (
            <line
              x1={hoveredX}
              x2={hoveredX}
              y1={0}
              y2={yMax}
              stroke={VX.crosshair}
              strokeWidth={1}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          )}
          {/* Active crosshair when hovering this chart */}
          {hoveredX !== null && isDirectHover && (
            <line
              x1={hoveredX}
              x2={hoveredX}
              y1={0}
              y2={yMax}
              stroke={line}
              strokeOpacity={0.4}
              strokeWidth={1}
              pointerEvents="none"
            />
          )}

          <AxisLeftNumeric
            scale={yScale}
            numTicks={4}
            tickFormat={(v) => fmtMin(Number(v))}
          />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>

      <ChartTooltip
        tip={isDirectHover ? tip : null}
        tooltipRef={tooltipRef}
        styles={tooltipStyles}
      >
        {tip?.data && (
          <>
            <TooltipHeader
              date={tip.data.date}
              label={tip.data.activities.length === 0 ? 'Rest' : fmtMin(tip.data.totalDurationMin)}
              labelColor={tip.data.activities.length === 0 ? tooltipMuted : axisColor}
            />
            <TooltipBody>
              {tip.data.activities.length === 0 ? (
                <div style={{ padding: '4px 10px', fontSize: 11, color: tooltipMuted }}>
                  No recorded workouts
                </div>
              ) : (
                tip.data.activities.map((a, idx) => (
                  <ActivityTooltipRow
                    key={a.activity_id}
                    activity={a}
                    isFirst={idx === 0}
                  />
                ))
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

function ActivityTooltipRow({
  activity,
  isFirst,
}: {
  activity: GarminActivity
  isFirst: boolean
}) {
  const { tooltipMuted } = useVxTheme()
  const meta = activityTypeMeta(activity.type_key)
  const dur = (activity.duration_sec ?? 0) / 60
  const isGym = meta.label === 'Gym'
  const showDistinctName =
    activity.activity_name &&
    activity.activity_name.toLowerCase() !== meta.label.toLowerCase() &&
    !isGym
  const aero = activity.aerobic_te
  const anaero = activity.anaerobic_te
  const teText =
    aero !== null || anaero !== null
      ? `TE ${aero?.toFixed(1) ?? '—'}/${anaero?.toFixed(1) ?? '—'}`
      : null
  const hrText =
    activity.avg_hr !== null || activity.max_hr !== null
      ? `HR ${activity.avg_hr ?? '—'}/${activity.max_hr ?? '—'}`
      : null
  const loadText = activity.training_load !== null ? `Load ${Math.round(activity.training_load)}` : null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '4px 10px',
        borderTop: isFirst ? 'none' : '1px solid rgba(128,128,128,0.15)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          backgroundColor: meta.color,
          marginTop: 5,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontWeight: 500 }}>
            {meta.label}
            {showDistinctName ? (
              <span style={{ fontWeight: 400, opacity: 0.7 }}> · {activity.activity_name}</span>
            ) : null}
          </span>
          <span>{fmtMin(dur)}</span>
        </div>
        <div style={{ fontSize: 10.5, color: tooltipMuted, marginTop: 2 }}>
          {[hrText, teText, loadText].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
    </div>
  )
}

export function ActivityStackChart({
  activities,
  dateFrom,
  dateTo,
}: {
  activities: GarminActivity[]
  dateFrom: string
  dateTo: string
}) {
  const buckets = useMemo(
    () => buildActivityBuckets(activities, dateFrom, dateTo),
    [activities, dateFrom, dateTo],
  )
  const legendItems = useMemo(
    () =>
      activityLegendTypes(activities).map((m) => ({
        key: m.label,
        label: m.label,
        color: m.color,
        shape: 'bar' as const,
      })),
    [activities],
  )
  const totalMin = useMemo(
    () => buckets.reduce((s, b) => s + b.totalDurationMin, 0),
    [buckets],
  )
  const activeDays = useMemo(() => buckets.filter((b) => b.totalDurationMin > 0).length, [buckets])

  return (
    <ChartCard
      title="Activities"
      subtitle="What did I do?"
      tooltip={METRIC_TOOLTIPS.activities}
      extra={
        <span style={{ fontSize: 13, opacity: 0.75 }}>
          {activeDays} active · {fmtMin(totalMin)}
        </span>
      }
    >
      <div style={{ height: 240 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <ActivityStackInner
              buckets={buckets}
              width={Math.max(width, 200)}
              height={240}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend items={legendItems} highlighted={null} onHighlight={() => {}} />
    </ChartCard>
  )
}

// ── ACWR Threshold Chart ─────────────────────────────────────────────────

export function ACWRThresholdChart({ data }: { data: DailyMetric[] }) {
  const { line } = useVxTheme()
  const loadData = useMemo(() => computeTrainingLoad(data), [data])
  const latest = loadData[loadData.length - 1]

  return (
    <ChartCard
      title="Training Load (ACWR)"
      subtitle="Am I overloading?"
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
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <ZonedLine<TrainingLoadPoint>
              data={loadData}
              width={Math.max(width, 200)}
              height={280}
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
  const latest = loadData[loadData.length - 1]

  const headerExtra =
    latest !== undefined ? (
      <span style={{ fontSize: 12 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: latest.divergence >= 0 ? VX.goodSolid : VX.badSolid,
          }}
        >
          {latest.divergence >= 0 ? '+' : ''}
          {latest.divergence.toFixed(1)}
        </span>
        <span style={{ opacity: 0.5 }}> Gap</span>
      </span>
    ) : null

  return (
    <ChartCard
      title="Short vs Long Load"
      subtitle="Is load spiking or tapering?"
      tooltip={METRIC_TOOLTIPS.loadBalance}
      extra={headerExtra}
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <DivergenceChartInner
              data={loadData}
              width={Math.max(width, 200)}
              height={280}
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
  const { line } = useVxTheme()
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const latest = chartData[chartData.length - 1]

  const headerExtra =
    latest && latest.sleepScore !== null ? (
      <span style={{ fontSize: 12 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: scoreColor(latest.sleepScore),
          }}
        >
          {latest.sleepScore}
        </span>
        {(() => {
          const total = (latest.deep ?? 0) + (latest.light ?? 0) + (latest.rem ?? 0)
          return total > 0 ? <span style={{ opacity: 0.5 }}> · {total.toFixed(1)}h</span> : null
        })()}
      </span>
    ) : null

  return (
    <ChartCard
      title="Sleep Quality"
      subtitle="How well did I sleep?"
      tooltip={METRIC_TOOLTIPS.sleepStages}
      extra={headerExtra}
    >
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
                  color: line,
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
                    color={line}
                    label="Total"
                    value={`${total.toFixed(1)}h`}
                    shape="line"
                    strokeWidth={2}
                  />
                )
              }}
              highlightedKey={highlighted}
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
          { key: 'sleepScore', label: 'Sleep Score', color: line, strokeWidth: 2 },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
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
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const latest = chartData[chartData.length - 1]

  return (
    <ChartCard
      title="Daily Activity"
      subtitle="Am I moving enough?"
      tooltip={METRIC_TOOLTIPS.activityScore}
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
            <span style={{ opacity: 0.5 }}> MET-min</span>
          </span>
        ) : null
      }
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <Bars<ActivityPoint>
              data={chartData}
              width={Math.max(width, 200)}
              height={280}
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
              highlightedKey={highlighted}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          {
            key: 'vigorousScore',
            label: 'Vigorous',
            color: VX.series.vigorousMin,
            shape: 'bar',
          },
          {
            key: 'moderateScore',
            label: 'Moderate',
            color: VX.series.intensityMin,
            shape: 'bar',
          },
          { key: 'walkingScore', label: 'Walking', color: VX.series.steps, shape: 'bar' },
          {
            key: 'scoreMA',
            label: '30d avg',
            color: line2,
            strokeWidth: 1.5,
            dashed: true,
          },
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
  const latest = chartData[chartData.length - 1]

  const headerExtra =
    latest && latest.recovery !== null ? (
      <span style={{ fontSize: 12 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: recoveryZoneLabel(latest.recovery).color,
          }}
        >
          {latest.recovery}
        </span>
        <span
          style={{
            marginLeft: 6,
            color: recoveryZoneLabel(latest.recovery).color,
          }}
        >
          {recoveryZoneLabel(latest.recovery).text}
        </span>
      </span>
    ) : null

  return (
    <ChartCard
      title="Recovery Trend"
      subtitle="Am I ready to push?"
      tooltip={METRIC_TOOLTIPS.recoveryScore}
      extra={headerExtra}
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <ZonedLine<RecoveryPoint>
              data={chartData}
              width={Math.max(width, 200)}
              height={280}
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

// ── Fitness Trends — unified z-score axis (RHR flipped) + VO2 dots ─────

type FitnessPoint = ReturnType<typeof buildFitnessData>[number]

function fmtSigma(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}σ`
}

function FitnessTrendChartInner({
  data,
  width,
  height,
  highlighted,
}: {
  data: FitnessPoint[]
  width: number
  height: number
  highlighted: string | null
}) {
  const { axis } = useVxTheme()
  const dim = (key: string): number => (highlighted === null || highlighted === key ? 1 : 0.15)
  const MARGIN_LOCAL = useMemo(
    () => ({
      ...VX.margin,
      left: Math.max(VX.margin.left, 48),
    }),
    [],
  )
  const xMax = width - MARGIN_LOCAL.left - MARGIN_LOCAL.right
  const yMax = height - MARGIN_LOCAL.top - MARGIN_LOCAL.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )

  // Single z-score axis — capped at ±2.5σ so spikes don't dominate the shape.
  const yScale = useMemo(() => {
    const vals: number[] = []
    for (const d of data) {
      if (d.rhrZ !== null) vals.push(d.rhrZ)
      if (d.hrvZ !== null) vals.push(d.hrvZ)
      if (d.vo2Z !== null) vals.push(d.vo2Z)
    }
    if (vals.length === 0) return scaleLinear<number>({ domain: [-2, 2], range: [yMax, 0] })
    const maxAbs = Math.min(2.5, Math.max(1.5, Math.max(...vals.map((v) => Math.abs(v))) * 1.1))
    return scaleLinear<number>({ domain: [-maxAbs, maxAbs], range: [yMax, 0], nice: true })
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
    () => data.filter((d): d is FitnessPoint & { rhrZ: number } => d.rhrZ !== null),
    [data],
  )
  const hrvValid = useMemo(
    () => data.filter((d): d is FitnessPoint & { hrvZ: number } => d.hrvZ !== null),
    [data],
  )
  const vo2Valid = useMemo(
    () =>
      data.filter(
        (d): d is FitnessPoint & { vo2Z: number; vo2max: number } =>
          d.vo2Z !== null && d.vo2max !== null,
      ),
    [data],
  )

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN_LOCAL.left} top={MARGIN_LOCAL.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {/* Zero line — "your baseline" */}
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

          <LinePath<FitnessPoint & { rhrZ: number }>
            data={rhrValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.rhrZ)}
            stroke={VX.series.restingHr}
            strokeWidth={2.5}
            strokeOpacity={dim('rhr')}
            curve={curveMonotoneX}
          />
          <LinePath<FitnessPoint & { hrvZ: number }>
            data={hrvValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.hrvZ)}
            stroke={VX.series.hrv}
            strokeWidth={2.5}
            strokeOpacity={dim('hrv')}
            curve={curveMonotoneX}
          />

          {vo2Valid.map((d) => (
            <circle
              key={`vo2-${d.date}`}
              cx={xScale(d.date) ?? 0}
              cy={yScale(d.vo2Z)}
              r={5}
              fill={VX.series.vo2max}
              fillOpacity={dim('vo2')}
              stroke={VX.dotStroke}
              strokeWidth={2}
              strokeOpacity={dim('vo2')}
            />
          ))}

          {syncedPoint &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
                  {syncedPoint.rhrZ !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.rhrZ)}
                      r={4}
                      fill={VX.series.restingHr}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                  {syncedPoint.hrvZ !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.hrvZ)}
                      r={4}
                      fill={VX.series.hrv}
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
              {tip.data.rhrZ !== null && tip.data.rhrMA !== null && (
                <TooltipRow
                  color={VX.series.restingHr}
                  label="RHR (7d)"
                  value={`${Math.round(tip.data.rhrMA)} bpm · ${fmtSigma(tip.data.rhrZ)}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.hrvZ !== null && tip.data.hrvMA !== null && (
                <TooltipRow
                  color={VX.series.hrv}
                  label="HRV (7d)"
                  value={`${Math.round(tip.data.hrvMA)} ms · ${fmtSigma(tip.data.hrvZ)}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.vo2Z !== null && tip.data.vo2max !== null && (
                <TooltipRow
                  color={VX.series.vo2max}
                  label="VO2 Max"
                  value={`${tip.data.vo2max.toFixed(1)} · ${fmtSigma(tip.data.vo2Z)}`}
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
  const [highlighted, setHighlighted] = useState<string | null>(null)

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
    <ChartCard
      title="Fitness Trends"
      subtitle="Is my body adapting?"
      tooltip={METRIC_TOOLTIPS.fitnessTrends}
      extra={headerExtra}
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <FitnessTrendChartInner
              data={chartData}
              width={Math.max(width, 200)}
              height={280}
              highlighted={highlighted}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          {
            key: 'rhr',
            label: 'RHR (lower = fitter)',
            color: VX.series.restingHr,
            strokeWidth: 2.5,
          },
          {
            key: 'hrv',
            label: 'HRV (7d avg)',
            color: VX.series.hrv,
            strokeWidth: 2.5,
          },
          { key: 'vo2', label: 'VO2 Max', color: VX.series.vo2max, shape: 'bar' },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}

// ── Body Battery — Energy Balance (diverging bars + Morning Low line) ──

type BodyBatteryPoint = ReturnType<typeof buildBodyBatteryData>[number]

const bbGetValue = (d: BodyBatteryPoint, k: string): number | null =>
  k === 'charged' ? d.charged : k === 'drained' ? d.drained : k === 'net' ? d.net : null

export function BodyBatteryRangeChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildBodyBatteryData(data), [data])
  const { line } = useVxTheme()
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const latest = chartData[chartData.length - 1]

  const headerExtra =
    latest && latest.net !== null ? (
      <span style={{ fontSize: 12 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: latest.net >= 0 ? VX.goodSolid : VX.badSolid,
          }}
        >
          {latest.net >= 0 ? '+' : ''}
          {latest.net}
        </span>
        <span style={{ opacity: 0.5 }}> Net</span>
      </span>
    ) : null

  return (
    <ChartCard
      title="Energy Balance"
      subtitle="Net recovery or deficit?"
      tooltip={METRIC_TOOLTIPS.bodyBattery}
      extra={headerExtra}
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <Bars<BodyBatteryPoint>
              data={chartData}
              width={Math.max(width, 200)}
              height={280}
              chartId="body-battery"
              getX={(d) => d.date}
              getValue={bbGetValue}
              positiveBars={[{ key: 'charged', label: 'Charged', color: VX.goodSolid }]}
              negativeBars={[{ key: 'drained', label: 'Drained', color: VX.badSolid }]}
              lines={[
                {
                  key: 'net',
                  label: 'Net',
                  color: line,
                  axisSide: 'left',
                  strokeWidth: 2,
                  formatValue: (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}`,
                },
              ]}
              leftAxis={{
                domain: 'auto',
                autoPad: 1.1,
                numTicks: 5,
                formatTick: (v) => (v === 0 ? '0' : v > 0 ? `+${v}` : String(v)),
              }}
              highlightedKey={highlighted}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'charged', label: 'Charged', color: VX.goodSolid, shape: 'bar' },
          { key: 'drained', label: 'Drained', color: VX.badSolid, shape: 'bar' },
          { key: 'net', label: 'Net', color: line, strokeWidth: 2 },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}

// ── Stress Levels — avg + sleep stress over 0–100 ──────────────────────

type StressPoint = ReturnType<typeof buildStressData>[number]

function StressLevelsChartInner({
  data,
  width,
  height,
  highlighted,
}: {
  data: StressPoint[]
  width: number
  height: number
  highlighted: string | null
}) {
  const { line, line2 } = useVxTheme()
  const dim = (key: string): number => (highlighted === null || highlighted === key ? 1 : 0.15)
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )
  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, 100], range: [yMax, 0] }), [yMax])

  const avgValid = useMemo(
    () => data.filter((d): d is StressPoint & { avgStress: number } => d.avgStress !== null),
    [data],
  )
  const sleepValid = useMemo(
    () => data.filter((d): d is StressPoint & { sleepStress: number } => d.sleepStress !== null),
    [data],
  )

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<StressPoint>({
      data,
      chartId: 'stress',
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

          {/* Gradient mapped to stress zones (userSpaceOnUse so each y-pixel has its own color) */}
          <defs>
            <linearGradient
              id="stress-zone-gradient"
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={yScale(100)}
              x2={0}
              y2={yScale(0)}
            >
              <stop offset="0%" stopColor={VX.badSolid} stopOpacity={0.45} />
              <stop offset="25%" stopColor={VX.badSolid} stopOpacity={0.3} />
              <stop offset="50%" stopColor={VX.warnSolid} stopOpacity={0.28} />
              <stop offset="75%" stopColor={VX.warnSolid} stopOpacity={0.15} />
              <stop offset="100%" stopColor={VX.goodSolid} stopOpacity={0.1} />
            </linearGradient>
          </defs>

          {/* Gradient-filled area under avg_stress */}
          <Threshold<StressPoint & { avgStress: number }>
            id="stress-area"
            data={avgValid}
            x={(d) => xScale(d.date) ?? 0}
            y0={() => yScale(0)}
            y1={(d) => yScale(d.avgStress)}
            clipAboveTo={0}
            clipBelowTo={yMax}
            curve={curveMonotoneX}
            belowAreaProps={{ fill: 'url(#stress-zone-gradient)', fillOpacity: dim('avg') }}
            aboveAreaProps={{ fill: 'url(#stress-zone-gradient)', fillOpacity: dim('avg') }}
          />

          {/* Zone thresholds: 25 (rest/low), 50 (low/moderate), 75 (moderate/high) */}
          <line
            x1={0}
            x2={xMax}
            y1={yScale(25)}
            y2={yScale(25)}
            stroke={VX.goodRef}
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScale(50)}
            y2={yScale(50)}
            stroke={VX.warnRef}
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScale(75)}
            y2={yScale(75)}
            stroke={VX.badRef}
            strokeDasharray="4 4"
          />

          {/* Avg stress — primary line (theme neutral so gradient carries the stress semantic) */}
          <LinePath<StressPoint & { avgStress: number }>
            data={avgValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.avgStress)}
            stroke={line}
            strokeWidth={2}
            strokeOpacity={dim('avg')}
            curve={curveMonotoneX}
          />

          {/* Overnight stress — grey dashed, should hug zero */}
          <LinePath<StressPoint & { sleepStress: number }>
            data={sleepValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.sleepStress)}
            stroke={line2}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            strokeOpacity={dim('sleep')}
            curve={curveMonotoneX}
          />

          {syncedPoint &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
                  {syncedPoint.avgStress !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.avgStress)}
                      r={4}
                      fill={line}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                  {syncedPoint.sleepStress !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.sleepStress)}
                      r={4}
                      fill={line2}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
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
            <TooltipHeader
              date={tip.data.date}
              label={
                tip.data.avgStress !== null ? stressZoneLabel(tip.data.avgStress).text : undefined
              }
              labelColor={
                tip.data.avgStress !== null ? stressZoneLabel(tip.data.avgStress).color : undefined
              }
            />
            <TooltipBody>
              {tip.data.avgStress !== null && (
                <TooltipRow
                  color={line}
                  label="Avg Stress"
                  value={String(Math.round(tip.data.avgStress))}
                  shape="line"
                  strokeWidth={2}
                />
              )}
              {tip.data.sleepStress !== null && (
                <TooltipRow
                  color={line2}
                  label="Overnight"
                  value={String(Math.round(tip.data.sleepStress))}
                  shape="line"
                  strokeWidth={1.5}
                  dashed
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

function stressZoneLabel(v: number): { text: string; color: string } {
  if (v >= 75) return { text: 'High', color: VX.badSolid }
  if (v >= 50) return { text: 'Moderate', color: VX.warnSolid }
  if (v >= 25) return { text: 'Low', color: VX.goodSolid }
  return { text: 'Rest', color: VX.goodSolid }
}

export function StressLevelsChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildStressData(data), [data])
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const { line, line2 } = useVxTheme()
  const latest = chartData[chartData.length - 1]

  const headerExtra =
    latest && latest.avgStress !== null ? (
      <span style={{ fontSize: 12 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: stressZoneLabel(latest.avgStress).color,
          }}
        >
          {Math.round(latest.avgStress)}
        </span>
        <span style={{ opacity: 0.5 }}> {stressZoneLabel(latest.avgStress).text}</span>
      </span>
    ) : null

  return (
    <ChartCard
      title="Stress Levels"
      subtitle="How calm was my day?"
      tooltip={METRIC_TOOLTIPS.stress}
      extra={headerExtra}
    >
      <div style={{ height: 280 }}>
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <StressLevelsChartInner
              data={chartData}
              width={Math.max(width, 200)}
              height={280}
              highlighted={highlighted}
            />
          )}
        </ParentSize>
      </div>
      <ChartLegend
        items={[
          { key: 'avg', label: 'Avg Stress', color: line, strokeWidth: 2 },
          {
            key: 'sleep',
            label: 'Overnight',
            color: line2,
            strokeWidth: 1.5,
            dashed: true,
          },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}
