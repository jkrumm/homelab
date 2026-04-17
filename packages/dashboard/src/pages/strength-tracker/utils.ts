import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { EXERCISES, PULL_UPS_BODYWEIGHT } from './constants'
import type { ChartDataPoint, ExerciseKey, MetricKey, Workout } from './types'

export function exerciseLabel(key: string): string {
  return EXERCISES.find((e) => e.value === key)?.label ?? key
}

function epley(weight: number, reps: number): number {
  if (reps === 1) return weight
  return weight * (1 + reps / 30)
}

function brzycki(weight: number, reps: number): number {
  if (reps === 1) return weight
  return (weight * 36) / (37 - reps)
}

function mayhew(weight: number, reps: number): number {
  if (reps === 1) return weight
  return weight / (0.522 + 0.419 * Math.exp(-0.055 * reps))
}

export function estimate1RM(weight: number, reps: number): number {
  if (reps === 1) return weight
  const formulas = [epley(weight, reps), mayhew(weight, reps)]
  if (reps < 37) formulas.push(brzycki(weight, reps))
  return formulas.reduce((sum, v) => sum + v, 0) / formulas.length
}

export function computeWorkoutMetrics(
  sets: { set_type: string; weight_kg: number; reps: number }[],
  exercise: ExerciseKey,
): { maxWeight: number; estimated1rm: number; totalVolume: number } {
  const isPullUps = exercise === 'pull_ups'
  const workSets = sets.filter((s) => s.set_type === 'work')

  const maxWeight =
    workSets.length > 0
      ? Math.max(
          ...workSets.map((s) => (isPullUps ? s.weight_kg + PULL_UPS_BODYWEIGHT : s.weight_kg)),
        )
      : 0

  let best1rm = 0
  for (const s of workSets) {
    const ew = isPullUps ? s.weight_kg + PULL_UPS_BODYWEIGHT : s.weight_kg
    const val = estimate1RM(ew, s.reps)
    if (val > best1rm) best1rm = val
  }
  const estimated1rm = workSets.length > 0 ? Math.round(best1rm * 10) / 10 : 0

  let totalVolume = 0
  for (const s of sets) {
    const ew = isPullUps ? s.weight_kg + PULL_UPS_BODYWEIGHT : s.weight_kg
    totalVolume += ew * s.reps
  }

  return { maxWeight, estimated1rm, totalVolume }
}

dayjs.extend(isoWeek)

export function formatXDate(dateStr: string): string {
  if (typeof dateStr !== 'string') return String(dateStr)
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

export function extractMetric(workout: Workout, metric: MetricKey): number | null {
  const ex = workout.exercise
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
    const ex = w.exercise
    if (!exercises.includes(ex) || typeof w.date !== 'string') continue
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

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null
  return ((current - previous) / previous) * 100
}

export interface SummaryStatsResult {
  best1rm: number
  current1rmAvg: number
  current1rmDelta: number | null
  weeklyVolume: number
  weeklyVolumeDelta: number | null
  avgIntensity: number | null
  intensityDelta: number | null
  freqPerWeek: number
  freqDelta: number | null
  sessionsLast30: number
  sessionsDelta: number | null
}

export function computeSummaryStats(
  workouts: Workout[],
  exercises: ExerciseKey[],
): SummaryStatsResult {
  const now = dayjs()
  const d7 = now.subtract(7, 'day').format('YYYY-MM-DD')
  const d14 = now.subtract(14, 'day').format('YYYY-MM-DD')
  const d30 = now.subtract(30, 'day').format('YYYY-MM-DD')
  const d60 = now.subtract(60, 'day').format('YYYY-MM-DD')

  const filtered = workouts.filter((w) => exercises.includes(w.exercise))

  // Best 1RM — all-time peak
  const best1rm = filtered
    .filter((w) => w.estimated_1rm !== null)
    .reduce((max, w) => Math.max(max, w.estimated_1rm!), 0)

  // Current 1RM — average of last 30d vs previous 30d
  const last30with1rm = filtered.filter((w) => w.date >= d30 && w.estimated_1rm !== null)
  const prev30with1rm = filtered.filter(
    (w) => w.date >= d60 && w.date < d30 && w.estimated_1rm !== null,
  )

  const current1rmAvg =
    last30with1rm.length > 0
      ? last30with1rm.reduce((sum, w) => sum + w.estimated_1rm!, 0) / last30with1rm.length
      : 0

  const prev1rmAvg =
    prev30with1rm.length > 0
      ? prev30with1rm.reduce((sum, w) => sum + w.estimated_1rm!, 0) / prev30with1rm.length
      : 0

  const current1rmDelta =
    current1rmAvg > 0 && prev1rmAvg > 0 ? pctChange(current1rmAvg, prev1rmAvg) : null

  // Weekly volume — last 7d vs previous 7d
  const weeklyVolume = filtered
    .filter((w) => w.date >= d7)
    .reduce((sum, w) => sum + w.total_volume, 0)

  const prevWeekVolume = filtered
    .filter((w) => w.date >= d14 && w.date < d7)
    .reduce((sum, w) => sum + w.total_volume, 0)

  const weeklyVolumeDelta = pctChange(weeklyVolume, prevWeekVolume)

  // Avg intensity — work set weight / 1RM, last 30d vs previous 30d
  const last30Intensity: number[] = []
  const prev30Intensity: number[] = []
  for (const w of filtered) {
    const val = extractMetric(w, 'avg_intensity')
    if (val === null) continue
    if (w.date >= d30) last30Intensity.push(val)
    else if (w.date >= d60) prev30Intensity.push(val)
  }
  const avgIntensity =
    last30Intensity.length > 0
      ? last30Intensity.reduce((sum, v) => sum + v, 0) / last30Intensity.length
      : null
  const prevIntensity =
    prev30Intensity.length > 0
      ? prev30Intensity.reduce((sum, v) => sum + v, 0) / prev30Intensity.length
      : null
  const intensityDelta =
    avgIntensity !== null && prevIntensity !== null ? pctChange(avgIntensity, prevIntensity) : null

  // Sessions last 30d + delta vs previous 30d
  const sessionsLast30 = filtered.filter((w) => w.date >= d30).length
  const sessionsPrev30 = filtered.filter((w) => w.date >= d60 && w.date < d30).length
  const sessionsDelta = pctChange(sessionsLast30, sessionsPrev30)

  // Frequency — sessions per week in last 30d vs previous 30d
  const weeksInPeriod = 30 / 7
  const freqPerWeek = Math.round((sessionsLast30 / weeksInPeriod) * 10) / 10
  const prevFreqPerWeek = Math.round((sessionsPrev30 / weeksInPeriod) * 10) / 10
  const freqDelta =
    freqPerWeek > 0 && prevFreqPerWeek > 0 ? pctChange(freqPerWeek, prevFreqPerWeek) : null

  return {
    best1rm,
    current1rmAvg,
    current1rmDelta,
    weeklyVolume,
    weeklyVolumeDelta,
    avgIntensity,
    intensityDelta,
    freqPerWeek,
    freqDelta,
    sessionsLast30,
    sessionsDelta,
  }
}

export function buildFrequencyData(
  workouts: Workout[],
  exercises: ExerciseKey[],
): Record<string, string | number>[] {
  const byWeek = new Map<string, Partial<Record<ExerciseKey, number>>>()

  for (const w of workouts) {
    const ex = w.exercise
    if (!exercises.includes(ex)) continue
    const d = dayjs(w.date)
    const year = d.isoWeekYear()
    const week = d.isoWeek()
    const key = `${year}-W${String(week).padStart(2, '0')}`
    const entry = byWeek.get(key) ?? {}
    entry[ex] = (entry[ex] ?? 0) + 1
    byWeek.set(key, entry)
  }

  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, counts]) => ({ week, ...counts }))
}

export interface PRPoint {
  date: string
  exercise: ExerciseKey
  value: number
}

export function findPRPoints(
  workouts: Workout[],
  metric: MetricKey,
  exercises: ExerciseKey[],
): PRPoint[] {
  const points: PRPoint[] = []

  for (const ex of exercises) {
    let runningMax = -Infinity
    const exWorkouts = workouts
      .filter((w) => w.exercise === ex)
      .sort((a, b) => a.date.localeCompare(b.date))

    for (let i = 0; i < exWorkouts.length; i++) {
      const value = extractMetric(exWorkouts[i], metric)
      if (value !== null && value > runningMax) {
        runningMax = value
        if (i > 0) points.push({ date: exWorkouts[i].date, exercise: ex, value })
      }
    }
  }

  return points
}
