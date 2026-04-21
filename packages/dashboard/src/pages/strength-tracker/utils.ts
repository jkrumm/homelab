import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { EXERCISES } from './constants'
import type { ChartDataPoint, ExerciseKey, MetricKey, Workout } from './types'

// ── Analytics helpers ─────────────────────────────────────────────────────

function sampleStdDevInternal(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sq = values.reduce((a, v) => a + (v - mean) * (v - mean), 0)
  return Math.sqrt(sq / (values.length - 1))
}

function linearReg(pairs: [number, number][]): { slope: number } | null {
  const n = pairs.length
  if (n < 2) return null
  const meanX = pairs.reduce((s, p) => s + p[0], 0) / n
  const meanY = pairs.reduce((s, p) => s + p[1], 0) / n
  const ssXX = pairs.reduce((s, p) => s + (p[0] - meanX) ** 2, 0)
  const ssXY = pairs.reduce((s, p) => s + (p[0] - meanX) * (p[1] - meanY), 0)
  if (ssXX === 0) return null
  return { slope: ssXY / ssXX }
}

function movingAvgIndex(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1)
    const slice = values.slice(start, i + 1).filter((v): v is number => v !== null)
    if (slice.length < Math.min(3, window)) return null
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

// Date-based MA for sparse series (looks back windowDays calendar days, not N entries)
function dateBasedMA(
  dates: string[],
  values: (number | undefined)[],
  windowDays: number,
): (number | null)[] {
  return dates.map((date, i) => {
    const cutoff = dayjs(date).subtract(windowDays, 'day').format('YYYY-MM-DD')
    const inWindow: number[] = []
    for (let j = 0; j <= i; j++) {
      const v = values[j]
      if (v !== undefined && dates[j]! >= cutoff) inWindow.push(v)
    }
    return inWindow.length >= 3 ? inWindow.reduce((a, b) => a + b, 0) / inWindow.length : null
  })
}

// ── Exported analytics ────────────────────────────────────────────────────

// f'(t) — slope of linear regression of e1RM over past windowDays, expressed as %/day
export function velocityPctPerDay(
  workouts: Workout[],
  exerciseId: string,
  windowDays = 28,
): number | null {
  const filtered = workouts
    .filter((w) => w.exercise_id === exerciseId && w.estimated_1rm !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (filtered.length < 2) return null

  const latest = filtered[filtered.length - 1]!
  const windowStart = dayjs(latest.date).subtract(windowDays, 'day')
  const inWindow = filtered.filter((w) => !dayjs(w.date).isBefore(windowStart))
  if (inWindow.length < 2) return null

  const pairs: [number, number][] = inWindow.map((w) => [
    dayjs(w.date).diff(windowStart, 'day'),
    w.estimated_1rm!,
  ])
  const reg = linearReg(pairs)
  if (!reg) return null
  const refE1rm = latest.estimated_1rm!
  return refE1rm > 0 ? (reg.slope / refE1rm) * 100 : null
}

export function strengthDirection(velocity: number | null): 'improving' | 'stable' | 'declining' {
  if (velocity === null) return 'stable'
  if (velocity > 0.1) return 'improving'
  if (velocity < -0.05) return 'declining'
  return 'stable'
}

export function sessionInol(workout: Workout, bodyweightKg = 80): number | null {
  const best1rm = workout.estimated_1rm
  if (!best1rm || best1rm <= 0) return null
  const isPullUps = workout.exercise_id === 'pull_ups'
  const rir = workout.rir
  let total = 0
  let count = 0
  for (const s of workout.sets) {
    if (
      (s.set_type !== 'work' && s.set_type !== 'amrap') ||
      s.reps < 1 ||
      s.reps > 12 ||
      (rir !== null && rir !== undefined && rir > 3)
    )
      continue
    const ew = isPullUps ? s.weight_kg + bodyweightKg : s.weight_kg
    const pct = Math.max(40, Math.min(99, (ew / best1rm) * 100))
    total += s.reps / (100 - pct)
    count++
  }
  return count > 0 ? total : null
}

export function weeklyWorkVolume(
  workouts: Workout[],
  exerciseId: string,
  weekEndDate: string,
): number {
  const start = dayjs(weekEndDate).subtract(7, 'day').format('YYYY-MM-DD')
  return workouts
    .filter((w) => w.exercise_id === exerciseId && w.date >= start && w.date <= weekEndDate)
    .reduce((sum, w) => sum + w.total_volume, 0)
}

export function tonnageGrowthRatio(
  workouts: Workout[],
  exerciseId: string,
  date: string,
): number | null {
  const dateD = dayjs(date)
  let ma28Sum = 0
  for (let i = 0; i < 4; i++) {
    const end = dateD.subtract(i * 7, 'day').format('YYYY-MM-DD')
    ma28Sum += weeklyWorkVolume(workouts, exerciseId, end)
  }
  const ma28 = ma28Sum / 4
  if (ma28 <= 0) return null
  const thisWeek = weeklyWorkVolume(workouts, exerciseId, date)
  return thisWeek / ma28
}

// ── Chart data types & builders ──────────────────────────────────────────

export type BestSetInfo = {
  weight_kg: number
  reps: number
  rir: number | null
  e1rm: number
}

export type OneRmPoint = {
  date: string
  e1rm: Record<string, number | null>
  ma: Record<string, number | null>
  bestSets: Record<string, BestSetInfo | null>
}

function extractBestSet(workout: Workout, bodyweightKg = 80): BestSetInfo | null {
  const best1rm = workout.estimated_1rm
  if (!best1rm) return null
  const isPullUps = workout.exercise_id === 'pull_ups'
  const rir = workout.rir
  let bestE1rm: number | null = null
  let bestWeight = 0
  let bestReps = 0
  for (const s of workout.sets) {
    if (
      (s.set_type !== 'work' && s.set_type !== 'amrap') ||
      s.reps < 1 ||
      s.reps > 12 ||
      (rir !== null && rir !== undefined && rir > 3)
    )
      continue
    const ew = isPullUps ? s.weight_kg + bodyweightKg : s.weight_kg
    const e1rm = estimate1RM(ew, s.reps)
    if (e1rm !== null && (bestE1rm === null || e1rm > bestE1rm)) {
      bestE1rm = e1rm
      bestWeight = ew
      bestReps = s.reps
    }
  }
  if (bestE1rm === null) return null
  return {
    weight_kg: Math.round(bestWeight * 10) / 10,
    reps: bestReps,
    rir,
    e1rm: Math.round(bestE1rm * 10) / 10,
  }
}

export function buildOneRmChartData(workouts: Workout[], exerciseIds: string[]): OneRmPoint[] {
  type Entry = {
    e1rm: Record<string, number>
    bestSets: Record<string, BestSetInfo | null>
  }
  const byDate = new Map<string, Entry>()

  for (const w of workouts) {
    if (!exerciseIds.includes(w.exercise_id) || w.estimated_1rm === null) continue
    const entry = byDate.get(w.date) ?? { e1rm: {}, bestSets: {} }
    const prev = entry.e1rm[w.exercise_id] ?? 0
    if (w.estimated_1rm > prev) {
      entry.e1rm[w.exercise_id] = w.estimated_1rm
      entry.bestSets[w.exercise_id] = extractBestSet(w)
    }
    byDate.set(w.date, entry)
  }

  const dates = Array.from(byDate.keys()).sort()

  const maMap: Record<string, (number | null)[]> = {}
  for (const exId of exerciseIds) {
    const vals = dates.map((d) => byDate.get(d)?.e1rm[exId] ?? undefined)
    maMap[exId] = dateBasedMA(dates, vals, 30)
  }

  return dates.map((date, i) => {
    const entry = byDate.get(date)!
    const e1rm: Record<string, number | null> = {}
    const ma: Record<string, number | null> = {}
    const bestSets: Record<string, BestSetInfo | null> = {}
    for (const exId of exerciseIds) {
      e1rm[exId] = entry.e1rm[exId] ?? null
      ma[exId] = maMap[exId]?.[i] ?? null
      bestSets[exId] = entry.bestSets[exId] ?? null
    }
    return { date, e1rm, ma, bestSets }
  })
}

export type CompositePoint = {
  date: string
  velocityRaw: number | null
  tonnageGrowthRaw: number | null
  inolRaw: number | null
  velocityZ: number | null
  tonnageGrowthZ: number | null
  inolZ: number | null
  velocityZma: number | null
  tonnageGrowthZma: number | null
  inolZma: number | null
}

function velocityAtDate(workouts: Workout[], exerciseId: string, date: string): number | null {
  const filtered = workouts
    .filter((w) => w.exercise_id === exerciseId && w.estimated_1rm !== null && w.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (filtered.length < 2) return null
  const latest = filtered[filtered.length - 1]!
  const windowStart = dayjs(date).subtract(28, 'day')
  const inWindow = filtered.filter((w) => !dayjs(w.date).isBefore(windowStart))
  if (inWindow.length < 2) return null
  const pairs: [number, number][] = inWindow.map((w) => [
    dayjs(w.date).diff(windowStart, 'day'),
    w.estimated_1rm!,
  ])
  const reg = linearReg(pairs)
  if (!reg) return null
  const refE1rm = latest.estimated_1rm!
  return refE1rm > 0 ? (reg.slope / refE1rm) * 100 : null
}

export function buildCompositeData(workouts: Workout[], exerciseId: string): CompositePoint[] {
  const exWorkouts = workouts
    .filter((w) => w.exercise_id === exerciseId)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (exWorkouts.length === 0) return []

  const raw = exWorkouts.map((w) => ({
    date: w.date,
    velocity: velocityAtDate(workouts, exerciseId, w.date),
    tonnageGrowth: tonnageGrowthRatio(workouts, exerciseId, w.date),
    inol: sessionInol(w),
  }))

  // 90-day baseline window from the last point
  const lastDate = dayjs(exWorkouts[exWorkouts.length - 1]!.date)
  const cutoff90 = lastDate.subtract(90, 'day').format('YYYY-MM-DD')
  const window90 = raw.filter((p) => p.date >= cutoff90)

  const velVals = window90.map((p) => p.velocity).filter((v): v is number => v !== null)
  const tonVals = window90.map((p) => p.tonnageGrowth).filter((v): v is number => v !== null)
  const inolVals = window90.map((p) => p.inol).filter((v): v is number => v !== null)

  const velMean = velVals.length ? velVals.reduce((a, b) => a + b, 0) / velVals.length : null
  const tonMean = tonVals.length ? tonVals.reduce((a, b) => a + b, 0) / tonVals.length : null
  const inolMean = inolVals.length ? inolVals.reduce((a, b) => a + b, 0) / inolVals.length : null

  const velSd = Math.max(sampleStdDevInternal(velVals) ?? 0, 0.05)
  const tonSd = Math.max(sampleStdDevInternal(tonVals) ?? 0, 0.02)
  const inolSd = Math.max(sampleStdDevInternal(inolVals) ?? 0, 0.1)

  const zScore = (v: number | null, mean: number | null, sd: number): number | null => {
    if (v === null || mean === null) return null
    return (v - mean) / sd
  }

  const zPoints = raw.map((p) => ({
    date: p.date,
    velocityRaw: p.velocity,
    tonnageGrowthRaw: p.tonnageGrowth,
    inolRaw: p.inol,
    velocityZ: zScore(p.velocity, velMean, velSd),
    tonnageGrowthZ: zScore(p.tonnageGrowth, tonMean, tonSd),
    inolZ: zScore(p.inol, inolMean, inolSd),
  }))

  const velZma = movingAvgIndex(
    zPoints.map((p) => p.velocityZ),
    7,
  )
  const tonZma = movingAvgIndex(
    zPoints.map((p) => p.tonnageGrowthZ),
    7,
  )
  const inolZma = movingAvgIndex(
    zPoints.map((p) => p.inolZ),
    7,
  )

  return zPoints.map((p, i) => ({
    ...p,
    velocityZma: velZma[i] ?? null,
    tonnageGrowthZma: tonZma[i] ?? null,
    inolZma: inolZma[i] ?? null,
  }))
}

// Default bodyweight for pull-ups when no user context is available
const PULL_UPS_BW_DEFAULT = 80

export function exerciseLabel(key: string): string {
  return EXERCISES.find((e) => e.value === key)?.label ?? key
}

function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30)
}

function brzycki(weight: number, reps: number): number {
  return (weight * 36) / (37 - reps)
}

// Returns null if reps > 12 (outside validity range).
// Brzycki valid for reps ∈ [1,10], Epley valid for reps ∈ [1,12].
// Both valid → average; only Epley valid (reps 11-12) → Epley only.
export function estimate1RM(weight: number, reps: number): number | null {
  if (reps < 1 || reps > 12) return null
  if (reps <= 10) {
    return (epley(weight, reps) + brzycki(weight, reps)) / 2
  }
  return epley(weight, reps)
}

export function eligibleForE1RM(
  set: { set_type: string; reps: number },
  workoutRir: number | null | undefined,
): boolean {
  return (
    (set.set_type === 'work' || set.set_type === 'amrap') &&
    set.reps >= 1 &&
    set.reps <= 12 &&
    (workoutRir === null || workoutRir === undefined || workoutRir <= 3)
  )
}

export function computeWorkoutMetrics(
  sets: { set_type: string; weight_kg: number; reps: number }[],
  exercise_id: string,
  workoutRir?: number | null,
  bodyweightKg?: number,
): {
  maxWeight: number
  estimated1rm: number | null
  best1rmSet: { set_type: string; weight_kg: number; reps: number } | null
  totalVolume: number
} {
  const bw = bodyweightKg ?? PULL_UPS_BW_DEFAULT
  const isPullUps = exercise_id === 'pull_ups'
  const eligibleSets = sets.filter((s) => eligibleForE1RM(s, workoutRir))

  const maxWeight =
    eligibleSets.length > 0
      ? Math.max(...eligibleSets.map((s) => (isPullUps ? s.weight_kg + bw : s.weight_kg)))
      : 0

  let best1rm: number | null = null
  let best1rmSet: (typeof sets)[0] | null = null

  for (const s of eligibleSets) {
    const ew = isPullUps ? s.weight_kg + bw : s.weight_kg
    const e1rm = estimate1RM(ew, s.reps)
    if (e1rm !== null && (best1rm === null || e1rm > best1rm)) {
      best1rm = e1rm
      best1rmSet = s
    }
  }

  const estimated1rm = best1rm !== null ? Math.round(best1rm * 10) / 10 : null

  let totalVolume = 0
  for (const s of sets) {
    const ew = isPullUps ? s.weight_kg + bw : s.weight_kg
    totalVolume += ew * s.reps
  }

  return { maxWeight, estimated1rm, best1rmSet, totalVolume }
}

dayjs.extend(isoWeek)

export function formatXDate(dateStr: string): string {
  if (typeof dateStr !== 'string') return String(dateStr)
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

export function extractMetric(workout: Workout, metric: MetricKey): number | null {
  const ex = workout.exercise_id
  const isPullUps = ex === 'pull_ups'

  switch (metric) {
    case 'max_weight': {
      const workSets = workout.sets.filter((s) => s.set_type === 'work')
      if (workSets.length === 0) return null
      const heaviest = Math.max(...workSets.map((s) => s.weight_kg))
      return isPullUps ? heaviest + PULL_UPS_BW_DEFAULT : heaviest
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
      const effectiveWeight = isPullUps ? maxWeight + PULL_UPS_BW_DEFAULT : maxWeight
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
    const ex = w.exercise_id as ExerciseKey
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
  return data.map((point) => {
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

  const filtered = workouts.filter((w) => exercises.includes(w.exercise_id as ExerciseKey))

  const best1rm = filtered
    .filter((w) => w.estimated_1rm !== null)
    .reduce((max, w) => Math.max(max, w.estimated_1rm!), 0)

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

  const weeklyVolume = filtered
    .filter((w) => w.date >= d7)
    .reduce((sum, w) => sum + w.total_volume, 0)

  const prevWeekVolume = filtered
    .filter((w) => w.date >= d14 && w.date < d7)
    .reduce((sum, w) => sum + w.total_volume, 0)

  const weeklyVolumeDelta = pctChange(weeklyVolume, prevWeekVolume)

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

  const sessionsLast30 = filtered.filter((w) => w.date >= d30).length
  const sessionsPrev30 = filtered.filter((w) => w.date >= d60 && w.date < d30).length
  const sessionsDelta = pctChange(sessionsLast30, sessionsPrev30)

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
    const ex = w.exercise_id as ExerciseKey
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
      .filter((w) => w.exercise_id === ex)
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
