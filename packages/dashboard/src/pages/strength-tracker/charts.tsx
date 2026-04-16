import { Card, Select, Space, Switch, Typography } from 'antd'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { EXERCISE_COLORS, EXERCISES, METRICS } from './constants'
import type { ExerciseKey, MetricKey, Workout } from './types'
import {
  buildChartData,
  buildChartDataWithMA,
  buildFrequencyData,
  findPRPoints,
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

function exerciseLabel(value: string): string {
  const ex = value.replace('_ma', '')
  const label = EXERCISES.find((e) => e.value === ex)?.label ?? ex
  return value.endsWith('_ma') ? `${label} (30d avg)` : label
}

// ── MainChart — Dual-axis configurable line chart ─────────────────────────

interface MainChartProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
}

export function MainChart({ workouts, activeExercises }: MainChartProps) {
  const [leftMetric, setLeftMetric] = useState<MetricKey>('estimated_1rm')
  const [rightMetric, setRightMetric] = useState<MetricKey>('max_weight')
  const [showMA, setShowMA] = useState(false)

  const leftMeta = METRICS.find((m) => m.value === leftMetric)!
  const rightMeta = METRICS.find((m) => m.value === rightMetric)!

  const prPoints = useMemo(
    () => findPRPoints(workouts, leftMetric, activeExercises),
    [workouts, leftMetric, activeExercises],
  )

  const data = useMemo(() => {
    const leftData = buildChartDataWithMA(
      workouts,
      leftMetric,
      activeExercises,
      showMA ? 30 : undefined,
    )
    const rightData = buildChartData(workouts, rightMetric, activeExercises)

    const allDates = Array.from(
      new Set([...leftData.map((d) => d.date), ...rightData.map((d) => d.date)]),
    ).sort()

    const leftMap = new Map(leftData.map((d) => [d.date, d]))
    const rightMap = new Map(rightData.map((d) => [d.date, d]))

    return allDates.map((date) => {
      const left = leftMap.get(date)
      const right = rightMap.get(date)
      const point: Record<string, number | string> = { date }
      for (const ex of activeExercises) {
        if (left?.[ex] !== undefined) point[`left_${ex}`] = left[ex] as number
        if (left?.[`${ex}_ma`] !== undefined) point[`left_${ex}_ma`] = left[`${ex}_ma`] as number
        if (right?.[ex] !== undefined) point[`right_${ex}`] = right[ex] as number
      }
      return point
    })
  }, [workouts, leftMetric, rightMetric, activeExercises, showMA])

  return (
    <Card
      title="Strength Trends"
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        <Space size={12} align="center" wrap>
          <Space size={4} align="center">
            <Switch size="small" checked={showMA} onChange={setShowMA} />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              30d avg
            </Typography.Text>
          </Space>
          <Select
            value={leftMetric}
            onChange={setLeftMetric}
            options={METRICS}
            size="small"
            style={{ width: 130 }}
            popupMatchSelectWidth={false}
          />
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            vs
          </Typography.Text>
          <Select
            value={rightMetric}
            onChange={setRightMetric}
            options={METRICS}
            size="small"
            style={{ width: 130 }}
            popupMatchSelectWidth={false}
          />
        </Space>
      }
    >
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11 }}
            unit={` ${leftMeta.unit}`}
            width={56}
            domain={['auto', 'auto']}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            unit={` ${rightMeta.unit}`}
            width={56}
            domain={['auto', 'auto']}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(
              value: number,
              name: string,
              props: { payload?: Record<string, unknown> },
            ): [string, string] => {
              const isMA = name.includes('_ma')
              const isLeft = name.startsWith('left_')
              const ex = name.replace('left_', '').replace('right_', '').replace('_ma', '')
              const exLabel = EXERCISES.find((e) => e.value === ex)?.label ?? ex
              const meta = isLeft ? leftMeta : rightMeta
              const suffix = isMA ? ' (30d avg)' : ''
              const date = String(props.payload?.date ?? '')
              const isPR =
                isLeft &&
                !isMA &&
                prPoints.some((pr) => pr.date === date && pr.exercise === ex)
              const prTag = isPR ? ' PR' : ''
              return [
                `${value.toFixed(1)} ${meta.unit}${prTag}`,
                `${exLabel} — ${meta.label}${suffix}`,
              ]
            }}
          />
          <Legend
            formatter={(value: string) => {
              const isMA = value.includes('_ma')
              const isLeft = value.startsWith('left_')
              const ex = value.replace('left_', '').replace('right_', '').replace('_ma', '')
              const exLabel = EXERCISES.find((e) => e.value === ex)?.label ?? ex
              const meta = isLeft ? leftMeta : rightMeta
              const suffix = isMA ? ' (avg)' : ''
              const side = isLeft ? '◆' : '◇'
              return `${side} ${exLabel} — ${meta.label}${suffix}`
            }}
          />
          {activeExercises.map((ex) => (
            <Line
              key={`left_${ex}`}
              yAxisId="left"
              type="monotone"
              dataKey={`left_${ex}`}
              stroke={EXERCISE_COLORS[ex]}
              dot={data.length < 10 ? { r: 3, fill: EXERCISE_COLORS[ex] } : false}
              strokeWidth={2}
              connectNulls
            />
          ))}
          {showMA &&
            activeExercises.map((ex) => (
              <Line
                key={`left_${ex}_ma`}
                yAxisId="left"
                type="monotone"
                dataKey={`left_${ex}_ma`}
                stroke={EXERCISE_COLORS[ex]}
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                connectNulls
              />
            ))}
          {activeExercises.map((ex) => (
            <Line
              key={`right_${ex}`}
              yAxisId="right"
              type="monotone"
              dataKey={`right_${ex}`}
              stroke={EXERCISE_COLORS[ex]}
              dot={data.length < 10 ? { r: 2, fill: EXERCISE_COLORS[ex], opacity: 0.6 } : false}
              strokeWidth={2}
              strokeDasharray="8 4"
              connectNulls
              opacity={0.6}
            />
          ))}
          {prPoints.map((pr) => (
            <ReferenceDot
              key={`pr_${pr.date}_${pr.exercise}`}
              x={pr.date}
              y={pr.value}
              yAxisId="left"
              r={5}
              fill="#faad14"
              stroke={EXERCISE_COLORS[pr.exercise]}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── AreaMetricChart — Configurable stacked area chart ──────────────────────

interface AreaMetricChartProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
}

export function AreaMetricChart({ workouts, activeExercises }: AreaMetricChartProps) {
  const [metric, setMetric] = useState<MetricKey>('total_volume')

  const meta = METRICS.find((m) => m.value === metric)!

  const data = useMemo(
    () => buildChartData(workouts, metric, activeExercises),
    [workouts, metric, activeExercises],
  )

  return (
    <Card
      title="Training Load"
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        <Select
          value={metric}
          onChange={setMetric}
          options={METRICS}
          size="small"
          style={{ width: 130 }}
          popupMatchSelectWidth={false}
        />
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit={` ${meta.unit}`} width={56} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string): [string, string] => [
              `${value.toFixed(1)} ${meta.unit}`,
              exerciseLabel(name),
            ]}
          />
          <Legend formatter={exerciseLabel} />
          {activeExercises.map((ex) => (
            <Area
              key={ex}
              type="monotone"
              dataKey={ex}
              stroke={EXERCISE_COLORS[ex]}
              fill={EXERCISE_COLORS[ex]}
              fillOpacity={0.15}
              strokeWidth={1.5}
              stackId="area"
              connectNulls
              dot={data.length < 10 ? { r: 3, fill: EXERCISE_COLORS[ex] } : false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── FrequencyChart ─────────────────────────────────────────────────────────

interface FrequencyChartProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
}

export function FrequencyChart({ workouts, activeExercises }: FrequencyChartProps) {
  const data = useMemo(
    () => buildFrequencyData(workouts, activeExercises),
    [workouts, activeExercises],
  )

  return (
    <Card title="Training Frequency (Sessions / Week)" size="small" style={{ marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="week" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string): [string, string] => [
              `${value} session${value !== 1 ? 's' : ''}`,
              exerciseLabel(name),
            ]}
          />
          <Legend formatter={exerciseLabel} />
          {activeExercises.map((ex) => (
            <Bar key={ex} dataKey={ex} fill={EXERCISE_COLORS[ex]} stackId="freq" />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}
