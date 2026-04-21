import { Card, Select, Space, Switch, Typography, theme } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { EXERCISE_COLORS, METRICS } from './constants'
import type { ExerciseKey, MetricKey, Workout } from './types'
import { useLocalState } from './use-local-state'
import {
  buildChartData,
  buildChartDataWithMA,
  buildFrequencyData,
  exerciseLabel,
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

function useChartColor(activeExercises: ExerciseKey[]) {
  const { token } = theme.useToken()
  const neutral = token.colorText
  return useCallback(
    (ex: ExerciseKey) =>
      activeExercises.length === 1 ? neutral : (EXERCISE_COLORS[ex] ?? neutral),
    [activeExercises.length, neutral],
  )
}

// ── MainChart — Dual-axis configurable line chart ─────────────────────────

interface MainChartProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
}

const METRIC_OPTIONS_WITH_NONE = [{ value: 'none', label: 'None' }, ...METRICS]

export function MainChart({ workouts, activeExercises }: MainChartProps) {
  const getColor = useChartColor(activeExercises)
  const [leftMetric, setLeftMetric] = useLocalState<MetricKey | 'none'>(
    'st-left-metric',
    'estimated_1rm',
  )
  const [rightMetric, setRightMetric] = useLocalState<MetricKey | 'none'>(
    'st-right-metric',
    'max_weight',
  )
  const [showMA, setShowMA] = useLocalState('st-show-ma', false)
  const [showPRs, setShowPRs] = useState(false)
  const [prOpacity, setPrOpacity] = useState(0)

  const leftMeta = METRICS.find((m) => m.value === leftMetric)
  const rightMeta = METRICS.find((m) => m.value === rightMetric)

  const prPoints = useMemo(
    () => (leftMetric !== 'none' ? findPRPoints(workouts, leftMetric, activeExercises) : []),
    [workouts, leftMetric, activeExercises],
  )

  useEffect(() => {
    setShowPRs(false)
    setPrOpacity(0)
    const t1 = setTimeout(() => setShowPRs(true), 1500)
    const t2 = setTimeout(() => setPrOpacity(1), 1550)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [prPoints])

  const data = useMemo(() => {
    const leftData =
      leftMetric !== 'none'
        ? buildChartDataWithMA(workouts, leftMetric, activeExercises, showMA ? 30 : undefined)
        : []
    const rightData =
      rightMetric !== 'none' ? buildChartData(workouts, rightMetric, activeExercises) : []

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
            options={METRIC_OPTIONS_WITH_NONE}
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
            options={METRIC_OPTIONS_WITH_NONE}
            size="small"
            style={{ width: 130 }}
            popupMatchSelectWidth={false}
          />
        </Space>
      }
    >
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          {leftMeta && (
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11 }}
              unit={` ${leftMeta.unit}`}
              width={56}
              domain={['auto', 'auto']}
            />
          )}
          {rightMeta && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11 }}
              unit={` ${rightMeta.unit}`}
              width={56}
              domain={['auto', 'auto']}
            />
          )}
          {/* Hidden axes when metric is "none" — Recharts requires yAxisId targets to exist */}
          {!leftMeta && <YAxis yAxisId="left" hide />}
          {!rightMeta && <YAxis yAxisId="right" hide />}
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
              const exLabel = exerciseLabel(ex)
              const meta = isLeft ? leftMeta : rightMeta
              if (!meta) return [`${value.toFixed(1)}`, exLabel]
              const suffix = isMA ? ' (30d avg)' : ''
              const date = String(props.payload?.date ?? '')
              const isPR =
                isLeft && !isMA && prPoints.some((pr) => pr.date === date && pr.exercise === ex)
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
              const exLabel = exerciseLabel(ex)
              const meta = isLeft ? leftMeta : rightMeta
              if (!meta) return exLabel
              const suffix = isMA ? ' (avg)' : ''
              const side = isLeft ? '◆' : '◇'
              return `${side} ${exLabel} — ${meta.label}${suffix}`
            }}
          />
          {leftMeta &&
            activeExercises.map((ex) => (
              <Line
                key={`left_${ex}`}
                yAxisId="left"
                type="monotone"
                dataKey={`left_${ex}`}
                stroke={getColor(ex)}
                dot={data.length < 10 ? { r: 3, fill: getColor(ex) } : false}
                strokeWidth={2}
                connectNulls
              />
            ))}
          {leftMeta &&
            showMA &&
            activeExercises.map((ex) => (
              <Line
                key={`left_${ex}_ma`}
                yAxisId="left"
                type="monotone"
                dataKey={`left_${ex}_ma`}
                stroke={getColor(ex)}
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                connectNulls
              />
            ))}
          {rightMeta &&
            activeExercises.map((ex) => (
              <Line
                key={`right_${ex}`}
                yAxisId="right"
                type="monotone"
                dataKey={`right_${ex}`}
                stroke={getColor(ex)}
                dot={data.length < 10 ? { r: 2, fill: getColor(ex), opacity: 0.6 } : false}
                strokeWidth={2}
                strokeDasharray="8 4"
                connectNulls
                opacity={0.6}
              />
            ))}
          {showPRs &&
            prPoints.map((pr) => (
              <ReferenceDot
                key={`pr_${pr.date}_${pr.exercise}`}
                x={pr.date}
                y={pr.value}
                yAxisId="left"
                r={5}
                fill={getColor(pr.exercise)}
                stroke={getColor(pr.exercise)}
                strokeWidth={2}
                fillOpacity={prOpacity}
                strokeOpacity={prOpacity}
                style={{ transition: 'fill-opacity 500ms ease, stroke-opacity 500ms ease' }}
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
  const getColor = useChartColor(activeExercises)
  const [metric, setMetric] = useLocalState<MetricKey>('st-area-metric', 'total_volume')
  const [showPRs, setShowPRs] = useState(false)
  const [prOpacity, setPrOpacity] = useState(0)

  const meta = METRICS.find((m) => m.value === metric)!

  const prPoints = useMemo(
    () => findPRPoints(workouts, metric, activeExercises),
    [workouts, metric, activeExercises],
  )

  useEffect(() => {
    setShowPRs(false)
    setPrOpacity(0)
    const t1 = setTimeout(() => setShowPRs(true), 1500)
    const t2 = setTimeout(() => setPrOpacity(1), 1550)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [prPoints])

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
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart data={data} margin={{ ...CHART_MARGIN, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit={` ${meta.unit}`} width={56} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(
              value: number,
              name: string,
              props: { payload?: Record<string, unknown> },
            ): [string, string] => {
              const ex = name.replace('_ma', '')
              const date = String(props.payload?.date ?? '')
              const isPR = prPoints.some((pr) => pr.date === date && pr.exercise === ex)
              const prTag = isPR ? ' PR' : ''
              return [`${value.toFixed(1)} ${meta.unit}${prTag}`, exerciseLabel(name)]
            }}
          />
          {activeExercises.map((ex) => (
            <Area
              key={ex}
              type="monotone"
              dataKey={ex}
              stroke={getColor(ex)}
              fill={getColor(ex)}
              fillOpacity={0.15}
              strokeWidth={1.5}
              stackId="area"
              connectNulls
              dot={data.length < 10 ? { r: 3, fill: getColor(ex) } : false}
            />
          ))}
          {showPRs &&
            prPoints.map((pr) => (
              <ReferenceDot
                key={`pr_${pr.date}_${pr.exercise}`}
                x={pr.date}
                y={pr.value}
                r={5}
                fill={getColor(pr.exercise)}
                stroke={getColor(pr.exercise)}
                strokeWidth={2}
                fillOpacity={prOpacity}
                strokeOpacity={prOpacity}
                style={{ transition: 'fill-opacity 500ms ease, stroke-opacity 500ms ease' }}
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
  const getColor = useChartColor(activeExercises)
  const data = useMemo(
    () => buildFrequencyData(workouts, activeExercises),
    [workouts, activeExercises],
  )

  return (
    <Card title="Training Frequency (Sessions / Week)" size="small" style={{ marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ ...CHART_MARGIN, bottom: 0 }}>
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
          {activeExercises.map((ex) => (
            <Bar key={ex} dataKey={ex} fill={getColor(ex)} stackId="freq" />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}
