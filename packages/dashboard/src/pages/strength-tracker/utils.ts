import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { PULL_UPS_BODYWEIGHT } from './constants'
import type { ChartDataPoint, ExerciseKey, MetricKey, Workout } from './types'

dayjs.extend(isoWeek)

export function formatXDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}

export function extractMetric(workout: Workout, metric: MetricKey): number | null {
  const ex = workout.exercise as ExerciseKey
  const isPullUps = ex === 'pull_ups'

  switch (metric) {
    case 'max_weight': {
      const workSets = workout.sets.filter((s) => s.set_type === 'work')
      if (workSets.length === 0) return null
      const heaviest = Math.max(...workSets.map((s) => s.weight_kg))
      return isPullUps ? heaviest + PULL_UPS_BODYWEIGHT : heaviest
    }
    case 'estimated_1rm':
      return workout.estimated_1rm
    case 'total_volume':
      return workout.total_volume
    case 'total_reps':
      return workout.sets.reduce((sum, s) => sum + s.reps, 0)
    case 'work_sets':
      return workout.sets.filter((s) => s.set_type === 'work').length
    case 'avg_intensity': {
      if (!workout.estimated_1rm) return null
      const workSets = workout.sets.filter((s) => s.set_type === 'work')
      if (workSets.length === 0) return null
      const maxWeight = Math.max(...workSets.map((s) => s.weight_kg))
      const effectiveWeight = isPullUps ? maxWeight + PULL_UPS_BODYWEIGHT : maxWeight
      return (effectiveWeight / workout.estimated_1rm) * 100
    }
    default:
      return null
  }
}

export function buildChartData(
  workouts: Workout[],
  metric: MetricKey,
  exercises: ExerciseKey[],
): ChartDataPoint[] {
  const byDate = new Map<string, Partial<Record<ExerciseKey, number>>>()

  for (const w of workouts) {
    const ex = w.exercise as ExerciseKey
    if (!exercises.includes(ex)) continue
    const entry = byDate.get(w.date) ?? {}
    const value = extractMetric(w, metric)
    if (value !== null) {
      entry[ex] = Math.max((entry[ex] as number | undefined) ?? 0, value)
    }
    byDate.set(w.date, entry)
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, ...values }))
}

export function computeMovingAverage(
  data: { date: string; value: number }[],
  windowDays: number,
): { date: string; value: number }[] {
  return data.map((point, _i) => {
    const pointDate = dayjs(point.date)
    const windowStart = pointDate.subtract(windowDays, 'day')
    const inWindow = data.filter((d) => {
      const dDate = dayjs(d.date)
      return !dDate.isBefore(windowStart) && !dDate.isAfter(pointDate)
    })
    const avg = inWindow.reduce((sum, d) => sum + d.value, 0) / inWindow.length
    return { date: point.date, value: Math.round(avg * 10) / 10 }
  })
}

export function buildChartDataWithMA(
  workouts: Workout[],
  metric: MetricKey,
  exercises: ExerciseKey[],
  maWindow?: number,
): ChartDataPoint[] {
  const base = buildChartData(workouts, metric, exercises)

  if (!maWindow) return base

  const result: ChartDataPoint[] = base.map((point) => ({ ...point }))

  for (const ex of exercises) {
    const seriesData = base
      .filter((p) => p[ex] !== undefined)
      .map((p) => ({ date: p.date, value: p[ex] as number }))

    const ma = computeMovingAverage(seriesData, maWindow)
    const maMap = new Map(ma.map((d) => [d.date, d.value]))

    for (const point of result) {
      const maVal = maMap.get(point.date)
      if (maVal !== undefined) {
        point[`${ex}_ma`] = maVal
      }
    }
  }

  return result
}

export function computeSummaryStats(workouts: Workout[], exercises: ExerciseKey[]) {
  const now = dayjs()
  const weekStart = now.subtract(7, 'day').format('YYYY-MM-DD')
  const monthStart = now.subtract(30, 'day').format('YYYY-MM-DD')
  const prevMonthStart = now.subtract(60, 'day').format('YYYY-MM-DD')

  const filtered = workouts.filter((w) => exercises.includes(w.exercise as ExerciseKey))

  const weeklyVolume = filtered
    .filter((w) => w.date >= weekStart)
    .reduce((sum, w) => sum + w.total_volume, 0)

  const sessionsLast30 = workouts.filter((w) => w.date >= monthStart).length

  const best1rm = filtered
    .filter((w) => w.estimated_1rm !== null)
    .reduce((max, w) => Math.max(max, w.estimated_1rm!), 0)

  const latestByExercise = new Map<ExerciseKey, number>()
  for (const w of [...filtered].reverse()) {
    const ex = w.exercise as ExerciseKey
    if (!latestByExercise.has(ex) && w.estimated_1rm !== null) {
      latestByExercise.set(ex, w.estimated_1rm)
    }
  }
  const latest1rm = latestByExercise.size > 0 ? Math.max(...latestByExercise.values()) : 0

  const prWeight = filtered.reduce((max, w) => {
    const workSets = w.sets.filter((s) => s.set_type === 'work')
    if (workSets.length === 0) return max
    const isPullUps = w.exercise === 'pull_ups'
    const heaviest = Math.max(...workSets.map((s) => s.weight_kg))
    return Math.max(max, isPullUps ? heaviest + PULL_UPS_BODYWEIGHT : heaviest)
  }, 0)

  const last30Avg =
    filtered
      .filter((w) => w.date >= monthStart && w.estimated_1rm !== null)
      .reduce((sum, w) => sum + w.estimated_1rm!, 0) /
    Math.max(1, filtered.filter((w) => w.date >= monthStart && w.estimated_1rm !== null).length)

  const prev30Avg =
    filtered
      .filter((w) => w.date >= prevMonthStart && w.date < monthStart && w.estimated_1rm !== null)
      .reduce((sum, w) => sum + w.estimated_1rm!, 0) /
    Math.max(
      1,
      filtered.filter(
        (w) => w.date >= prevMonthStart && w.date < monthStart && w.estimated_1rm !== null,
      ).length,
    )

  const diff = last30Avg - prev30Avg
  const trend: 'up' | 'down' | 'flat' = diff > 1 ? 'up' : diff < -1 ? 'down' : 'flat'

  const sessionsInLast30 = workouts.filter((w) => w.date >= monthStart).length
  const weeksInPeriod = 30 / 7
  const freqPerWeek = Math.round((sessionsInLast30 / weeksInPeriod) * 10) / 10

  return {
    best1rm,
    latest1rm,
    prWeight,
    weeklyVolume,
    sessionsLast30,
    trend,
    freqPerWeek,
  }
}

export function buildFrequencyData(workouts: Workout[]): { week: string; count: number }[] {
  const byWeek = new Map<string, number>()

  for (const w of workouts) {
    const d = dayjs(w.date)
    const year = d.isoWeekYear()
    const week = d.isoWeek()
    const key = `${year}-W${String(week).padStart(2, '0')}`
    byWeek.set(key, (byWeek.get(key) ?? 0) + 1)
  }

  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, count }))
}
