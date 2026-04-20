import { Card, Tooltip as AntTooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyMetric } from './types'
import { COLORS, METRIC_TOOLTIPS } from './constants'
import {
  acwrZoneColor,
  acwrZoneLabel,
  buildActivityData,
  buildBodyBatteryData,
  buildFitnessData,
  buildRecoveryTrendData,
  buildSleepChartData,
  buildStressData,
  computeFitnessSummary,
  computeTrainingLoad,
  formatXDate,
} from './utils'

const SYNC_ID = 'garmin'
const GRID_STROKE = 'rgba(128,128,128,0.15)'
const CHART_MARGIN = { top: 5, right: 16, bottom: 5, left: 0 }
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatTooltipDate(label: string | number): string {
  if (typeof label !== 'string') return String(label)
  const parts = label.split('-')
  if (parts.length !== 3) return label
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  if (Number.isNaN(d.getTime())) return label
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${DAYS[d.getDay()]} ${dd}.${mm}.${yy}`
}

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    border: 'none',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    lineHeight: '18px',
  },
  labelStyle: { color: 'rgba(255, 255, 255, 0.65)', fontSize: 11, marginBottom: 2 },
  itemStyle: { color: 'rgba(255, 255, 255, 0.85)', padding: 0, fontSize: 12 },
  labelFormatter: formatTooltipDate,
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

// ── Fitness Progression — smoothed RHR + HRV trends ─────────────────────

export function FitnessChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildFitnessData(data), [data])
  const summary = useMemo(() => computeFitnessSummary(data), [data])

  const headerExtra = (
    <span style={{ fontSize: 12 }}>
      {summary.vo2max !== null && (
        <span style={{ marginRight: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: COLORS.vo2max }}>
            {summary.vo2max.toFixed(1)}
          </span>
          <span style={{ opacity: 0.5 }}> VO2</span>
        </span>
      )}
      {summary.rhrDelta !== null && (
        <span style={{ marginRight: 12 }}>
          <span style={{ color: summary.rhrDelta <= 0 ? '#00c853' : '#ff3d00', fontWeight: 600 }}>
            {summary.rhrDelta > 0 ? '+' : ''}
            {summary.rhrDelta.toFixed(0)}
          </span>
          <span style={{ opacity: 0.5 }}> RHR</span>
        </span>
      )}
      {summary.hrvDelta !== null && (
        <span>
          <span style={{ color: summary.hrvDelta >= 0 ? '#00c853' : '#ff3d00', fontWeight: 600 }}>
            {summary.hrvDelta > 0 ? '+' : ''}
            {summary.hrvDelta.toFixed(0)}
          </span>
          <span style={{ opacity: 0.5 }}> HRV</span>
        </span>
      )}
    </span>
  )

  return (
    <Card
      title={<ChartTitle title="Fitness Trends" tooltip={METRIC_TOOLTIPS.fitnessTrends} />}
      size="small"
      style={{ marginBottom: 16 }}
      extra={headerExtra}
    >
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={CHART_MARGIN} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis
            yAxisId="hr"
            tick={{ fontSize: 11 }}
            unit=" bpm"
            width={56}
            domain={['auto', 'auto']}
            reversed
          />
          <YAxis
            yAxisId="hrv"
            orientation="right"
            tick={{ fontSize: 11 }}
            unit=" ms"
            width={52}
            domain={['auto', 'auto']}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, [string, string]> = {
                rhr: [`${value} bpm`, 'RHR (daily)'],
                rhrMA: [`${value} bpm`, 'RHR (7d avg)'],
                hrv: [`${value} ms`, 'HRV (daily)'],
                hrvMA: [`${value} ms`, 'HRV (7d avg)'],
                vo2max: [`${value.toFixed(1)}`, 'VO2 Max'],
              }
              return labels[name] ?? [`${value}`, name]
            }}
          />
          <Legend
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                rhrMA: 'RHR (7d avg) \u2193 better',
                hrvMA: 'HRV (7d avg) \u2191 better',
                vo2max: 'VO2 Max',
              }
              return labels[value] ?? value
            }}
          />
          {/* Daily values as faint dots */}
          <Line
            yAxisId="hr"
            type="monotone"
            dataKey="rhr"
            stroke={COLORS.restingHr}
            strokeWidth={0}
            dot={{ r: 2, fill: COLORS.restingHr, opacity: 0.25 }}
            connectNulls
            legendType="none"
          />
          <Line
            yAxisId="hrv"
            type="monotone"
            dataKey="hrv"
            stroke={COLORS.hrv}
            strokeWidth={0}
            dot={{ r: 2, fill: COLORS.hrv, opacity: 0.25 }}
            connectNulls
            legendType="none"
          />
          {/* 7-day moving average trend lines */}
          <Line
            yAxisId="hr"
            type="monotone"
            dataKey="rhrMA"
            stroke={COLORS.restingHr}
            strokeWidth={2.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="hrv"
            type="monotone"
            dataKey="hrvMA"
            stroke={COLORS.hrv}
            strokeWidth={2.5}
            dot={false}
            connectNulls
          />
          {/* VO2 Max as prominent dots */}
          <Line
            yAxisId="hrv"
            type="monotone"
            dataKey="vo2max"
            stroke={COLORS.vo2max}
            strokeWidth={0}
            dot={{ r: 5, fill: COLORS.vo2max, strokeWidth: 2, stroke: '#fff' }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Training Load (ACWR) — ratio with optimal zone band ─────────────────

export function TrainingLoadChart({ data }: { data: DailyMetric[] }) {
  const loadData = useMemo(() => computeTrainingLoad(data), [data])
  const latest = loadData[loadData.length - 1]
  const showDots = loadData.length < 15

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
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={loadData} margin={CHART_MARGIN} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 'auto']} tick={{ fontSize: 11 }} width={36} />
          <ReferenceArea y1={0.8} y2={1.3} fill="#00c853" fillOpacity={0.08} />
          <ReferenceArea y1={1.3} y2={1.5} fill="#ffd600" fillOpacity={0.06} />
          <ReferenceLine y={0.8} stroke="rgba(41,121,255,0.3)" strokeDasharray="4 4" />
          <ReferenceLine y={1.3} stroke="rgba(0,200,83,0.3)" strokeDasharray="4 4" />
          <ReferenceLine y={1.5} stroke="rgba(255,61,0,0.3)" strokeDasharray="4 4" />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              if (name === 'acwr') return [value.toFixed(2), 'ACWR']
              return [`${value}`, name]
            }}
          />
          <Legend formatter={() => 'ACWR (acute / chronic)'} />
          <Line
            type="monotone"
            dataKey="acwr"
            stroke={COLORS.acwr}
            strokeWidth={2.5}
            dot={showDots ? { r: 4, fill: COLORS.acwr } : false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Load MACD — divergence histogram + signal lines ─────────────────────

export function LoadMACDChart({ data }: { data: DailyMetric[] }) {
  const loadData = useMemo(() => computeTrainingLoad(data), [data])
  const showDots = loadData.length < 15

  return (
    <Card
      title={<ChartTitle title="Load Divergence" tooltip={METRIC_TOOLTIPS.loadBalance} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      {/* Top panel: Signal lines */}
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={loadData} margin={{ ...CHART_MARGIN, bottom: 0 }} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" hide />
          <YAxis tick={{ fontSize: 11 }} width={40} domain={[0, 'auto']} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                acute: 'Short-term (7d)',
                chronic: 'Long-term (28d)',
              }
              return [value.toFixed(1), labels[name] ?? name]
            }}
          />
          <Legend
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                acute: 'Short-term (7d)',
                chronic: 'Long-term (28d)',
              }
              return labels[value] ?? value
            }}
          />
          <Line
            type="monotone"
            dataKey="acute"
            stroke={COLORS.acute}
            strokeWidth={2}
            dot={showDots ? { r: 3, fill: COLORS.acute } : false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="chronic"
            stroke={COLORS.chronic}
            strokeWidth={2}
            dot={showDots ? { r: 3, fill: COLORS.chronic } : false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
      {/* Bottom panel: Divergence histogram */}
      <ResponsiveContainer width="100%" height={100}>
        <ComposedChart data={loadData} margin={{ ...CHART_MARGIN, top: 0 }} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 10 }} width={40} />
          <ReferenceLine y={0} stroke="rgba(128,128,128,0.3)" />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number) => [value.toFixed(1), 'Divergence']}
          />
          <Bar dataKey="divergence" radius={[2, 2, 0, 0]}>
            {loadData.map((entry, i) => (
              <Cell
                key={`div-${i}`}
                fill={entry.divergence >= 0 ? '#00c853' : '#ff3d00'}
                fillOpacity={0.6}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Recovery Trend — score with gradient zone fills ──────────────────────

export function RecoveryTrendChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildRecoveryTrendData(data), [data])
  const showDots = chartData.length < 15

  return (
    <Card
      title={<ChartTitle title="Recovery Trend" tooltip={METRIC_TOOLTIPS.recoveryScore} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={CHART_MARGIN} syncId={SYNC_ID}>
          <defs>
            <linearGradient id="recoveryGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00c853" stopOpacity={0.35} />
              <stop offset="50%" stopColor="#ffd600" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#ff3d00" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
          {/* Zone bands */}
          <ReferenceArea y1={70} y2={100} fill="#00c853" fillOpacity={0.04} />
          <ReferenceArea y1={40} y2={70} fill="#ffd600" fillOpacity={0.04} />
          <ReferenceArea y1={0} y2={40} fill="#ff3d00" fillOpacity={0.04} />
          <ReferenceLine y={70} stroke="rgba(0,200,83,0.25)" strokeDasharray="4 4" />
          <ReferenceLine y={40} stroke="rgba(255,61,0,0.25)" strokeDasharray="4 4" />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              if (name === 'recovery') {
                const zone = value >= 70 ? 'Push' : value >= 40 ? 'Normal' : 'Rest'
                return [`${Math.round(value)} (${zone})`, 'Recovery Score']
              }
              return [`${value}`, name]
            }}
          />
          <Legend formatter={() => 'Recovery Score'} />
          <Area
            type="monotone"
            dataKey="recovery"
            fill="url(#recoveryGrad)"
            stroke="#7c4dff"
            strokeWidth={2}
            dot={showDots ? { r: 3, fill: '#7c4dff' } : false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Sleep Stages — stacked bar + sleep score line ─────────────────────────

export function SleepChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildSleepChartData(data), [data])
  const showDots = chartData.length < 15

  return (
    <Card
      title={<ChartTitle title="Sleep Breakdown" tooltip={METRIC_TOOLTIPS.sleepStages} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={CHART_MARGIN} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis yAxisId="hours" tick={{ fontSize: 11 }} unit="h" width={40} />
          <YAxis
            yAxisId="score"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            width={36}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              if (name === 'sleepScore') return [`${value}`, 'Sleep Score']
              return [`${value.toFixed(1)}h`, name.charAt(0).toUpperCase() + name.slice(1)]
            }}
          />
          <Legend
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                deep: 'Deep',
                rem: 'REM',
                light: 'Light',
                awake: 'Awake',
                sleepScore: 'Sleep Score',
              }
              return labels[value] ?? value
            }}
          />
          <Bar yAxisId="hours" dataKey="deep" stackId="sleep" fill={COLORS.deep} />
          <Bar yAxisId="hours" dataKey="rem" stackId="sleep" fill={COLORS.rem} />
          <Bar yAxisId="hours" dataKey="light" stackId="sleep" fill={COLORS.light} />
          <Bar
            yAxisId="hours"
            dataKey="awake"
            stackId="sleep"
            fill={COLORS.awake}
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="score"
            type="monotone"
            dataKey="sleepScore"
            stroke={COLORS.sleepScore}
            dot={showDots ? { r: 3, fill: COLORS.sleepScore } : false}
            strokeWidth={2}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Body Battery — range area band ────────────────────────────────────────

export function BodyBatteryChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildBodyBatteryData(data), [data])
  const showDots = chartData.length < 15

  return (
    <Card
      title={<ChartTitle title="Body Battery" tooltip={METRIC_TOOLTIPS.bodyBattery} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={CHART_MARGIN} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                low: 'Morning Low',
                range: 'Daily Range',
              }
              return [`${value}`, labels[name] ?? name]
            }}
          />
          <ReferenceLine y={50} stroke="rgba(255,61,0,0.3)" strokeDasharray="4 4" />
          <Area
            type="monotone"
            dataKey="low"
            stackId="bb"
            fill="transparent"
            stroke={COLORS.bodyBatteryLow}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            connectNulls
          />
          <Area
            type="monotone"
            dataKey="range"
            stackId="bb"
            fill={COLORS.bodyBatteryHigh}
            fillOpacity={0.25}
            stroke={COLORS.bodyBatteryHigh}
            strokeWidth={2}
            dot={showDots ? { r: 3, fill: COLORS.bodyBatteryHigh } : false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Stress — average + sleep stress ──────────────────────────────────────

export function StressChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildStressData(data), [data])
  const showDots = chartData.length < 15

  return (
    <Card
      title={<ChartTitle title="Stress Levels" tooltip={METRIC_TOOLTIPS.stress} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={CHART_MARGIN} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                avgStress: 'Avg Stress',
                sleepStress: 'Sleep Stress',
              }
              return [`${Math.round(value)}`, labels[name] ?? name]
            }}
          />
          <ReferenceLine y={25} stroke="rgba(0,200,83,0.2)" strokeDasharray="4 4" />
          <ReferenceLine y={50} stroke="rgba(255,214,0,0.2)" strokeDasharray="4 4" />
          <Area
            type="monotone"
            dataKey="avgStress"
            stroke={COLORS.stress}
            fill={COLORS.stress}
            fillOpacity={0.15}
            strokeWidth={2}
            dot={showDots ? { r: 3, fill: COLORS.stress } : false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="sleepStress"
            stroke={COLORS.sleepStress}
            dot={showDots ? { r: 2, fill: COLORS.sleepStress } : false}
            strokeWidth={1.5}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Activity — steps bars + intensity minutes line ───────────────────────

export function ActivityChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildActivityData(data), [data])

  return (
    <Card
      title={<ChartTitle title="Daily Activity" tooltip={METRIC_TOOLTIPS.intensityMinutes} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={CHART_MARGIN} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis yAxisId="steps" tick={{ fontSize: 11 }} width={52} />
          <YAxis yAxisId="min" orientation="right" tick={{ fontSize: 11 }} unit=" min" width={52} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, [string, string]> = {
                steps: [value.toLocaleString(), 'Steps'],
                intensityMin: [`${Math.round(value)} min`, 'Intensity Minutes'],
              }
              return labels[name] ?? [`${value}`, name]
            }}
          />
          <ReferenceLine
            yAxisId="steps"
            y={10000}
            stroke="rgba(0,200,83,0.3)"
            strokeDasharray="4 4"
          />
          <Bar
            yAxisId="steps"
            dataKey="steps"
            fill={COLORS.steps}
            fillOpacity={0.7}
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="min"
            type="monotone"
            dataKey="intensityMin"
            stroke={COLORS.intensityMin}
            strokeWidth={2}
            dot={chartData.length < 15 ? { r: 3, fill: COLORS.intensityMin } : false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}
