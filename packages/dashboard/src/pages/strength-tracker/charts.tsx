import { Card, Select } from 'antd'
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { EXERCISE_COLORS, EXERCISES, METRICS } from './constants'
import type { ExerciseKey, MetricKey, Workout } from './types'
import { buildChartData, buildChartDataWithMA, buildFrequencyData, formatXDate } from './utils'

const GRID_STROKE = 'rgba(128,128,128,0.15)'
const CHART_MARGIN = { top: 5, right: 16, bottom: 5, left: 0 }

function legendFormatter(value: string): string {
  const ex = value.replace('_ma', '')
  const label = EXERCISES.find((e) => e.value === ex)?.label ?? ex
  return value.endsWith('_ma') ? `${label} (30d avg)` : label
}

function kgTooltipFormatter(value: number, name: string): [string, string] {
  return [`${value.toFixed(1)} kg`, legendFormatter(name)]
}

// ── OneRmChart ─────────────────────────────────────────────────────────────

interface OneRmChartProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
  showMA?: boolean
}

export function OneRmChart({ workouts, activeExercises, showMA }: OneRmChartProps) {
  const data = useMemo(
    () => buildChartDataWithMA(workouts, 'estimated_1rm', activeExercises, showMA ? 30 : undefined),
    [workouts, activeExercises, showMA],
  )

  return (
    <Card title="Estimated 1RM Trend" size="small" style={{ marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="kg" width={48} />
          <Tooltip formatter={kgTooltipFormatter} labelFormatter={(l) => `Date: ${l}`} />
          <Legend formatter={legendFormatter} />
          {activeExercises.map((ex) => (
            <Line
              key={ex}
              type="monotone"
              dataKey={ex}
              stroke={EXERCISE_COLORS[ex]}
              dot={false}
              strokeWidth={2}
              connectNulls
            />
          ))}
          {showMA &&
            activeExercises.map((ex) => (
              <Line
                key={`${ex}_ma`}
                type="monotone"
                dataKey={`${ex}_ma`}
                stroke={EXERCISE_COLORS[ex]}
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                connectNulls
              />
            ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── MaxWeightChart ─────────────────────────────────────────────────────────

interface MaxWeightChartProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
  showMA?: boolean
}

export function MaxWeightChart({ workouts, activeExercises, showMA }: MaxWeightChartProps) {
  const data = useMemo(
    () => buildChartDataWithMA(workouts, 'max_weight', activeExercises, showMA ? 30 : undefined),
    [workouts, activeExercises, showMA],
  )

  return (
    <Card title="Max Weight (Heaviest Work Set)" size="small" style={{ marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="kg" width={48} />
          <Tooltip formatter={kgTooltipFormatter} labelFormatter={(l) => `Date: ${l}`} />
          <Legend formatter={legendFormatter} />
          {activeExercises.map((ex) => (
            <Line
              key={ex}
              type="monotone"
              dataKey={ex}
              stroke={EXERCISE_COLORS[ex]}
              dot={false}
              strokeWidth={2}
              connectNulls
            />
          ))}
          {showMA &&
            activeExercises.map((ex) => (
              <Line
                key={`${ex}_ma`}
                type="monotone"
                dataKey={`${ex}_ma`}
                stroke={EXERCISE_COLORS[ex]}
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                connectNulls
              />
            ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── VolumeChart ────────────────────────────────────────────────────────────

interface VolumeChartProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
  showMA?: boolean
}

export function VolumeChart({ workouts, activeExercises, showMA }: VolumeChartProps) {
  const data = useMemo(
    () => buildChartDataWithMA(workouts, 'total_volume', activeExercises, showMA ? 30 : undefined),
    [workouts, activeExercises, showMA],
  )

  return (
    <Card title="Session Volume (kg)" size="small" style={{ marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="kg" width={48} />
          <Tooltip formatter={kgTooltipFormatter} />
          <Legend formatter={legendFormatter} />
          {activeExercises.map((ex) => (
            <Bar key={ex} dataKey={ex} fill={EXERCISE_COLORS[ex]} stackId="volume" />
          ))}
          {showMA &&
            activeExercises.map((ex) => (
              <Line
                key={`${ex}_ma`}
                type="monotone"
                dataKey={`${ex}_ma`}
                stroke={EXERCISE_COLORS[ex]}
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                connectNulls
              />
            ))}
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── SessionDensityChart ────────────────────────────────────────────────────

interface SessionDensityChartProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
}

export function SessionDensityChart({ workouts, activeExercises }: SessionDensityChartProps) {
  const data = useMemo(() => {
    const repsData = buildChartData(workouts, 'total_reps', activeExercises)
    const setsData = buildChartData(workouts, 'work_sets', activeExercises)

    const setsMap = new Map(setsData.map((d) => [d.date, d]))

    return repsData.map((point) => {
      const sets = setsMap.get(point.date)
      const totalReps = activeExercises.reduce((sum, ex) => sum + ((point[ex] as number) ?? 0), 0)
      return {
        date: point.date,
        ...Object.fromEntries(
          activeExercises.map((ex) => [`sets_${ex}`, sets ? ((sets[ex] as number) ?? 0) : 0]),
        ),
        total_reps: totalReps,
      }
    })
  }, [workouts, activeExercises])

  return (
    <Card title="Session Density (Sets + Total Reps)" size="small" style={{ marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} unit=" sets" width={52} />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            unit=" reps"
            width={52}
          />
          <Tooltip
            formatter={(value: number, name: string): [string, string] => {
              if (name === 'total_reps') return [`${value} reps`, 'Total Reps']
              const ex = name.replace('sets_', '')
              const label = EXERCISES.find((e) => e.value === ex)?.label ?? ex
              return [`${value} sets`, label]
            }}
          />
          <Legend
            formatter={(value: string) => {
              if (value === 'total_reps') return 'Total Reps'
              const ex = value.replace('sets_', '')
              return EXERCISES.find((e) => e.value === ex)?.label ?? ex
            }}
          />
          {activeExercises.map((ex) => (
            <Bar
              key={`sets_${ex}`}
              yAxisId="left"
              dataKey={`sets_${ex}`}
              fill={EXERCISE_COLORS[ex]}
              stackId="sets"
            />
          ))}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="total_reps"
            stroke="#8b5cf6"
            dot={false}
            strokeWidth={2}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── FrequencyChart ─────────────────────────────────────────────────────────

interface FrequencyChartProps {
  workouts: Workout[]
}

export function FrequencyChart({ workouts }: FrequencyChartProps) {
  const data = useMemo(() => buildFrequencyData(workouts), [workouts])

  return (
    <Card title="Training Frequency (Sessions / Week)" size="small" style={{ marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="week" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
          <Tooltip formatter={(value: number) => [`${value} sessions`, 'Sessions']} />
          <Bar dataKey="count" fill="#6366f1" />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── ComparisonChart ────────────────────────────────────────────────────────

interface ComparisonChartProps {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
}

export function ComparisonChart({ workouts, activeExercises }: ComparisonChartProps) {
  const [leftMetric, setLeftMetric] = useState<MetricKey>('estimated_1rm')
  const [rightMetric, setRightMetric] = useState<MetricKey>('total_volume')

  const leftMeta = METRICS.find((m) => m.value === leftMetric)!
  const rightMeta = METRICS.find((m) => m.value === rightMetric)!

  const data = useMemo(() => {
    const leftData = buildChartData(workouts, leftMetric, activeExercises)
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
        if (left && left[ex] !== undefined) point[`left_${ex}`] = left[ex] as number
        if (right && right[ex] !== undefined) point[`right_${ex}`] = right[ex] as number
      }
      return point
    })
  }, [workouts, leftMetric, rightMetric, activeExercises])

  return (
    <Card
      title="Metric Comparison"
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Select
            value={leftMetric}
            onChange={setLeftMetric}
            options={METRICS}
            size="small"
            style={{ width: 130 }}
            popupMatchSelectWidth={false}
          />
          <span style={{ fontSize: 11, color: 'rgba(128,128,128,0.7)' }}>vs</span>
          <Select
            value={rightMetric}
            onChange={setRightMetric}
            options={METRICS}
            size="small"
            style={{ width: 130 }}
            popupMatchSelectWidth={false}
          />
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} unit={` ${leftMeta.unit}`} width={56} />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            unit={` ${rightMeta.unit}`}
            width={56}
          />
          <Tooltip
            formatter={(value: number, name: string): [string, string] => {
              const isLeft = name.startsWith('left_')
              const ex = name.replace('left_', '').replace('right_', '')
              const exLabel = EXERCISES.find((e) => e.value === ex)?.label ?? ex
              const meta = isLeft ? leftMeta : rightMeta
              return [`${value.toFixed(1)} ${meta.unit}`, `${exLabel} (${meta.label})`]
            }}
          />
          <Legend
            formatter={(value: string) => {
              const isLeft = value.startsWith('left_')
              const ex = value.replace('left_', '').replace('right_', '')
              const exLabel = EXERCISES.find((e) => e.value === ex)?.label ?? ex
              const meta = isLeft ? leftMeta : rightMeta
              return `${exLabel} — ${meta.label}`
            }}
          />
          {activeExercises.map((ex) => (
            <Line
              key={`left_${ex}`}
              yAxisId="left"
              type="monotone"
              dataKey={`left_${ex}`}
              stroke={EXERCISE_COLORS[ex]}
              dot={false}
              strokeWidth={2}
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
              dot={false}
              strokeWidth={2}
              strokeDasharray="5 5"
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}
