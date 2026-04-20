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
  buildHeartChartData,
  buildSleepChartData,
  buildStressData,
  computeTrainingLoad,
  formatXDate,
} from './utils'

const GRID_STROKE = 'rgba(128,128,128,0.15)'
const CHART_MARGIN = { top: 5, right: 16, bottom: 5, left: 0 }
const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    border: 'none',
    borderRadius: 6,
    padding: '8px 12px',
  },
  labelStyle: { color: 'rgba(255, 255, 255, 0.85)' },
  itemStyle: { color: 'rgba(255, 255, 255, 0.85)' },
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
        <ComposedChart data={chartData} margin={CHART_MARGIN}>
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
          <Bar
            yAxisId="hours"
            dataKey="deep"
            stackId="sleep"
            fill={COLORS.deep}
            radius={[0, 0, 0, 0]}
          />
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
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                low: 'Morning Low',
                range: 'Daily Range',
                charged: 'Charged',
                drained: 'Drained',
              }
              return [`${value}`, labels[name] ?? name]
            }}
          />
          <ReferenceLine y={50} stroke="rgba(255,61,0,0.3)" strokeDasharray="4 4" />
          <Legend
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                low: 'Low',
                range: 'High-Low Range',
              }
              return labels[value] ?? value
            }}
          />
          {/* Invisible base area (0 to low) */}
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
          {/* Visible range area (low to high) */}
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

// ── Heart Rate + HRV — dual axis ─────────────────────────────────────────

export function HeartHrvChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildHeartChartData(data), [data])
  const showDots = chartData.length < 15

  return (
    <Card
      title={<ChartTitle title="Resting HR & HRV" tooltip={METRIC_TOOLTIPS.restingHr} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={CHART_MARGIN}>
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
                restingHr: [`${value} bpm`, 'Resting HR'],
                hrv: [`${value} ms`, 'HRV (nightly avg)'],
                hrvWeekly: [`${value} ms`, 'HRV (weekly avg)'],
              }
              return labels[name] ?? [`${value}`, name]
            }}
          />
          <Legend
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                restingHr: 'Resting HR',
                hrv: 'HRV (nightly)',
                hrvWeekly: 'HRV (weekly)',
              }
              return labels[value] ?? value
            }}
          />
          <Line
            yAxisId="hr"
            type="monotone"
            dataKey="restingHr"
            stroke={COLORS.restingHr}
            dot={showDots ? { r: 3, fill: COLORS.restingHr } : false}
            strokeWidth={2}
            connectNulls
          />
          <Line
            yAxisId="hrv"
            type="monotone"
            dataKey="hrv"
            stroke={COLORS.hrv}
            dot={showDots ? { r: 3, fill: COLORS.hrv } : false}
            strokeWidth={2}
            connectNulls
          />
          <Line
            yAxisId="hrv"
            type="monotone"
            dataKey="hrvWeekly"
            stroke={COLORS.hrvWeekly}
            dot={false}
            strokeWidth={1.5}
            strokeDasharray="5 5"
            connectNulls
          />
        </LineChart>
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
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                avgStress: 'Avg Stress',
                maxStress: 'Max Stress',
                sleepStress: 'Sleep Stress',
              }
              return [`${Math.round(value)}`, labels[name] ?? name]
            }}
          />
          <Legend
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                avgStress: 'Avg Stress',
                sleepStress: 'Sleep Stress',
              }
              return labels[value] ?? value
            }}
          />
          <ReferenceLine y={25} stroke="rgba(0,200,83,0.2)" strokeDasharray="4 4" />
          <ReferenceLine y={50} stroke="rgba(255,214,0,0.2)" strokeDasharray="4 4" />
          <ReferenceLine y={75} stroke="rgba(255,61,0,0.2)" strokeDasharray="4 4" />
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
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={CHART_MARGIN}>
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
          <Legend
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                steps: 'Steps',
                intensityMin: 'Intensity Min',
              }
              return labels[value] ?? value
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
        <ComposedChart data={loadData} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 'auto']} tick={{ fontSize: 11 }} width={36} />
          {/* Optimal zone band (0.8 - 1.3) */}
          <ReferenceArea y1={0.8} y2={1.3} fill="#00c853" fillOpacity={0.08} />
          {/* Caution zone (1.3 - 1.5) */}
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

// ── Load Balance — acute vs chronic EWMA lines ──────────────────────────

export function LoadBalanceChart({ data }: { data: DailyMetric[] }) {
  const loadData = useMemo(() => computeTrainingLoad(data), [data])
  const latest = loadData[loadData.length - 1]
  const showDots = loadData.length < 15

  return (
    <Card
      title={<ChartTitle title="Load Balance" tooltip={METRIC_TOOLTIPS.loadBalance} />}
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        latest ? (
          <span style={{ fontSize: 13 }}>
            <span style={{ color: COLORS.acute, fontWeight: 600 }}>{latest.acute}</span>
            <span style={{ opacity: 0.5, margin: '0 4px' }}>short</span>
            <span style={{ color: COLORS.chronic, fontWeight: 600 }}>{latest.chronic}</span>
            <span style={{ opacity: 0.5 }}> long</span>
          </span>
        ) : null
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={loadData} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={40} domain={[0, 'auto']} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                acute: 'Short-term (7d)',
                chronic: 'Long-term (28d)',
                dailyLoad: 'Daily Load',
              }
              return [value.toFixed(1), labels[name] ?? name]
            }}
          />
          <Legend
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                acute: 'Short-term (7d)',
                chronic: 'Long-term (28d)',
                dailyLoad: 'Daily Load',
              }
              return labels[value] ?? value
            }}
          />
          <Bar dataKey="dailyLoad" fill="rgba(128,128,128,0.15)" radius={[2, 2, 0, 0]} />
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
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}
