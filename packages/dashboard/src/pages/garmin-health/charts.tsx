import { Card, Tooltip as AntTooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyMetric } from './types'
import { COLORS, METRIC_TOOLTIPS } from './constants'
import {
  buildActivityData,
  buildBodyBatteryData,
  buildFitnessData,
  buildSleepChartData,
  buildStressData,
  computeFitnessSummary,
  formatXDate,
} from './utils'

const SYNC_ID = 'garmin'
const GRID_STROKE = 'rgba(128,128,128,0.15)'
const CHART_MARGIN = { top: 5, right: 16, bottom: 5, left: 0 }
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(label: unknown): string {
  if (label instanceof Date) {
    return `${SHORT_DAYS[label.getDay()]} ${MONTHS[label.getMonth()]} ${label.getDate()} ${label.getFullYear()}`
  }
  const s = String(label ?? '')
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return s
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(d.getTime())) return s
  return `${SHORT_DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`
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
  labelFormatter: fmtDate,
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
                rhrMA: [`${value} bpm`, 'RHR (7d avg)'],
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

// ── Sleep Stages — stacked bar + sleep score line ─────────────────────────

export function SleepChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildSleepChartData(data), [data])

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
            dot={false}
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
            dot={false}
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
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="sleepStress"
            stroke={COLORS.sleepStress}
            dot={false}
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
      <ResponsiveContainer width="100%" height={220}>
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
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}
