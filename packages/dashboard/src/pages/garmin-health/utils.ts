import type { DailyMetric } from './types'
import { VX } from '../../charts'

/** Extract non-null numeric values for a field */
function validValues(data: DailyMetric[], field: keyof DailyMetric): number[] {
  return data.map((d) => d[field]).filter((v): v is number => typeof v === 'number')
}

/** Average of a numeric field, null if no data */
export function fieldAvg(data: DailyMetric[], field: keyof DailyMetric): number | null {
  const vals = validValues(data, field)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** Most recent non-null numeric value */
export function latestValue(data: DailyMetric[], field: keyof DailyMetric): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i]![field]
    if (typeof v === 'number') return v
  }
  return null
}

/** Most recent non-null string value */
export function latestStringValue(data: DailyMetric[], field: keyof DailyMetric): string | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i]![field]
    if (typeof v === 'string') return v
  }
  return null
}

/** Delta (%) comparing second half of period to first half */
export function periodDelta(
  data: DailyMetric[],
  field: keyof DailyMetric,
  invertBetter?: boolean,
): number | null {
  if (data.length < 4) return null
  const mid = Math.floor(data.length / 2)
  const firstAvg = fieldAvg(data.slice(0, mid), field)
  const secondAvg = fieldAvg(data.slice(mid), field)
  if (firstAvg === null || secondAvg === null || firstAvg === 0) return null
  const raw = ((secondAvg - firstAvg) / Math.abs(firstAvg)) * 100
  return invertBetter ? -raw : raw
}

/** Format seconds to "Xh Ym" */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '\u2014'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

/** Seconds to hours (1 decimal) */
export function secToHours(seconds: number | null): number | null {
  if (seconds === null) return null
  return Math.round((seconds / 3600) * 10) / 10
}

/** Compute recovery score (0-100) from HRV, sleep score, and RHR */
export function computeRecoveryScore(
  metric: DailyMetric,
  avgHrv: number | null,
  avgRhr: number | null,
  minRhr: number | null,
  maxRhr: number | null,
): number | null {
  const { hrv_last_night_avg: hrv, sleep_score: sleep, resting_hr: rhr } = metric
  if (hrv === null && sleep === null && rhr === null) return null

  let score = 0
  let weight = 0

  if (hrv !== null && avgHrv !== null && avgHrv > 0) {
    score += Math.min(100, (hrv / avgHrv) * 100) * 0.4
    weight += 0.4
  }

  if (sleep !== null) {
    score += sleep * 0.35
    weight += 0.35
  }

  if (rhr !== null && minRhr !== null && maxRhr !== null && maxRhr > minRhr) {
    const rhrComp = (1 - (rhr - minRhr) / (maxRhr - minRhr)) * 100
    score += Math.max(0, Math.min(100, rhrComp)) * 0.25
    weight += 0.25
  }

  return weight === 0 ? null : Math.round(score / weight)
}

/** Build sleep stage chart data (seconds -> hours) */
export function buildSleepChartData(data: DailyMetric[]) {
  return data
    .filter((d) => d.sleep_duration_sec !== null)
    .map((d) => ({
      date: d.date,
      deep: secToHours(d.deep_sleep_sec),
      rem: secToHours(d.rem_sleep_sec),
      light: secToHours(d.light_sleep_sec),
      awake: secToHours(d.awake_sleep_sec),
      sleepScore: d.sleep_score,
    }))
}

/** Build body battery chart data with range for area band */
export function buildBodyBatteryData(data: DailyMetric[]) {
  return data
    .filter((d) => d.bb_highest !== null || d.bb_lowest !== null)
    .map((d) => ({
      date: d.date,
      high: d.bb_highest,
      low: d.bb_lowest,
      range: d.bb_highest !== null && d.bb_lowest !== null ? d.bb_highest - d.bb_lowest : null,
      charged: d.bb_charged,
      drained: d.bb_drained,
    }))
}

/** Build heart rate + HRV chart data */
export function buildHeartChartData(data: DailyMetric[]) {
  return data
    .filter((d) => d.resting_hr !== null || d.hrv_last_night_avg !== null)
    .map((d) => ({
      date: d.date,
      restingHr: d.resting_hr,
      hrv: d.hrv_last_night_avg,
      hrvWeekly: d.hrv_weekly_avg,
    }))
}

/** Build stress chart data */
export function buildStressData(data: DailyMetric[]) {
  return data
    .filter((d) => d.avg_stress !== null)
    .map((d) => ({
      date: d.date,
      avgStress: d.avg_stress,
      maxStress: d.max_stress,
      sleepStress: d.avg_sleep_stress,
    }))
}

/** Targets used for the composite Daily Activity score. */
export const ACTIVITY_INTENSITY_TARGET = 45 // min/day
export const ACTIVITY_STEPS_TARGET = 10000 // steps/day

/**
 * Composite Daily Activity score — 1.0 = hit both targets equally weighted
 * (70% intensity, 30% steps). Capped at 1.5 per metric so a single huge
 * day doesn't dominate the trend. Returns null when both inputs are null.
 */
function activityScore(steps: number | null, intensityMin: number | null): number | null {
  if (steps === null && intensityMin === null) return null
  const intensityPart =
    intensityMin !== null ? Math.min(1.5, intensityMin / ACTIVITY_INTENSITY_TARGET) : 0
  const stepsPart = steps !== null ? Math.min(1.5, steps / ACTIVITY_STEPS_TARGET) : 0
  return 0.7 * intensityPart + 0.3 * stepsPart
}

/** Build activity chart data — includes a composite 30d activity trend */
export function buildActivityData(data: DailyMetric[]) {
  const intensityArr = data.map((d) =>
    d.moderate_intensity_min !== null || d.vigorous_intensity_min !== null
      ? (d.moderate_intensity_min ?? 0) + (d.vigorous_intensity_min ?? 0)
      : null,
  )
  const scoreArr = data.map((d, i) => activityScore(d.steps, intensityArr[i] ?? null))
  const scoreMA = movingAverage(scoreArr, 30)
  return data
    .map((d, i) => ({
      date: d.date,
      steps: d.steps,
      intensityMin: intensityArr[i] ?? null,
      activityScore: scoreArr[i],
      // Plot the trend on the intensity-min axis: score 1.0 → 45 min-equivalent
      activityMAEquiv: scoreMA[i] !== null ? scoreMA[i]! * ACTIVITY_INTENSITY_TARGET : null,
      activityMAPct: scoreMA[i] !== null ? scoreMA[i]! * 100 : null,
      calories: d.total_kcal,
      activeCal: d.active_kcal,
    }))
    .filter((d) => d.steps !== null)
}

/** Sleep score → tooltip badge (text + color) per Garmin's bands. */
export function sleepScoreLabel(score: number | null): { text: string; color: string } | null {
  if (score === null) return null
  if (score >= 90) return { text: 'Excellent', color: VX.goodSolid }
  if (score >= 80) return { text: 'Good', color: VX.goodSolid }
  if (score >= 60) return { text: 'Fair', color: VX.warnSolid }
  return { text: 'Poor', color: VX.badSolid }
}

/** Format hours as "Xh Ym" — for sleep stage tooltip rows. */
export function formatHoursMin(hours: number | null): string {
  if (hours === null) return '—'
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h}h ${m}m`
}

// ── Moving Average ───────────────────────────────────────────────────────

function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1)
    const slice = values.slice(start, i + 1).filter((v): v is number => v !== null)
    return slice.length >= Math.min(3, window)
      ? Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 10) / 10
      : null
  })
}

/** Build fitness progression data — 7-day moving averages for trend visibility */
export function buildFitnessData(data: DailyMetric[]) {
  const rhrMA = movingAverage(
    data.map((d) => d.resting_hr),
    7,
  )
  const hrvMA = movingAverage(
    data.map((d) => d.hrv_last_night_avg),
    7,
  )

  return data
    .map((d, i) => ({
      date: d.date,
      rhrMA: rhrMA[i],
      hrvMA: hrvMA[i],
      rhr: d.resting_hr,
      hrv: d.hrv_last_night_avg,
      vo2max: d.vo2_max,
    }))
    .filter((d) => d.rhrMA !== null || d.hrvMA !== null)
}

/** Compute fitness direction summary */
export function computeFitnessSummary(data: DailyMetric[]) {
  // VO2 Max — latest non-null
  const vo2Values = data.filter((d) => d.vo2_max !== null)
  const vo2max = vo2Values.length > 0 ? vo2Values[vo2Values.length - 1]!.vo2_max : null

  // RHR trend: compare last 7d avg to first 7d avg (lower = better)
  const rhrFirst = fieldAvg(data.slice(0, Math.min(7, Math.floor(data.length / 2))), 'resting_hr')
  const rhrLast = fieldAvg(data.slice(-Math.min(7, Math.ceil(data.length / 2))), 'resting_hr')
  const rhrDelta = rhrFirst !== null && rhrLast !== null ? rhrLast - rhrFirst : null

  // HRV trend: compare last 7d avg to first 7d avg (higher = better)
  const hrvFirst = fieldAvg(
    data.slice(0, Math.min(7, Math.floor(data.length / 2))),
    'hrv_last_night_avg',
  )
  const hrvLast = fieldAvg(
    data.slice(-Math.min(7, Math.ceil(data.length / 2))),
    'hrv_last_night_avg',
  )
  const hrvDelta = hrvFirst !== null && hrvLast !== null ? hrvLast - hrvFirst : null

  // Chronic load trend (training capacity)
  const loadData = computeTrainingLoad(data)
  const chronicFirst =
    loadData.length > 7 ? loadData[Math.min(6, loadData.length - 1)]!.chronic : null
  const chronicLast = loadData.length > 0 ? loadData[loadData.length - 1]!.chronic : null

  return { vo2max, rhrDelta, hrvDelta, chronicFirst, chronicLast }
}

/** Format date for chart X axis — "17.04" */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatXDate(date: any): string {
  // Handle Date objects directly
  if (date instanceof Date) {
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    return `${dd}.${mm}`
  }
  const s = String(date ?? '')
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[3]}.${match[2]}`
  return s.length > 10 ? s.slice(0, 10) : s
}

// ── Training Load (ACWR) ─────────────────────────────────────────────────

export interface TrainingLoadPoint {
  date: string
  dailyLoad: number
  acute: number
  chronic: number
  acwr: number | null
  divergence: number
  divPos: number
  divNeg: number
  zone: 'undertrained' | 'optimal' | 'caution' | 'danger' | null
}

/**
 * Compute ACWR (Acute:Chronic Workload Ratio) using EWMA.
 *
 * Daily load approximated from Garmin intensity minutes:
 *   load = moderate_min × 1.0 + vigorous_min × 1.8
 *
 * EWMA decay rates (Hulin et al. 2017, BJSM):
 *   λ_acute  = 2/(7+1)  = 0.25   (~7-day half-life)
 *   λ_chronic = 2/(28+1) ≈ 0.069  (~28-day half-life)
 *
 * Zones (Gabbett 2016, BJSM):
 *   <0.8 undertrained | 0.8-1.3 optimal | 1.3-1.5 caution | >1.5 danger
 */
export function computeTrainingLoad(data: DailyMetric[]): TrainingLoadPoint[] {
  if (data.length === 0) return []

  const λA = 2 / (7 + 1)
  const λC = 2 / (28 + 1)

  const dailyLoads = data.map((d) => {
    const mod = d.moderate_intensity_min ?? 0
    const vig = d.vigorous_intensity_min ?? 0
    return mod * 1.0 + vig * 1.8
  })

  // Seed EWMA with average of available days (max 7)
  const seedN = Math.min(dailyLoads.length, 7)
  const seed = dailyLoads.slice(0, seedN).reduce((a, b) => a + b, 0) / seedN

  let ewmaA = seed
  let ewmaC = seed

  return data.map((d, i) => {
    const load = dailyLoads[i]!
    ewmaA = load * λA + ewmaA * (1 - λA)
    ewmaC = load * λC + ewmaC * (1 - λC)
    const acwr = ewmaC > 0 ? Math.round((ewmaA / ewmaC) * 100) / 100 : null

    let zone: TrainingLoadPoint['zone'] = null
    if (acwr !== null) {
      if (acwr < 0.8) zone = 'undertrained'
      else if (acwr <= 1.3) zone = 'optimal'
      else if (acwr <= 1.5) zone = 'caution'
      else zone = 'danger'
    }

    const div = Math.round((ewmaA - ewmaC) * 10) / 10
    return {
      date: d.date,
      dailyLoad: Math.round(load * 10) / 10,
      acute: Math.round(ewmaA * 10) / 10,
      chronic: Math.round(ewmaC * 10) / 10,
      acwr,
      divergence: div,
      divPos: Math.max(0, div),
      divNeg: Math.min(0, div),
      zone,
    }
  })
}

export function acwrZoneColor(zone: TrainingLoadPoint['zone']): string {
  switch (zone) {
    case 'optimal':
      return '#3fb950'
    case 'caution':
      return '#d29922'
    case 'danger':
      return '#f85149'
    case 'undertrained':
      return '#d29922'
    default:
      return '#8b949e'
  }
}

export function acwrZoneLabel(zone: TrainingLoadPoint['zone']): string {
  switch (zone) {
    case 'optimal':
      return 'Optimal'
    case 'caution':
      return 'High Load'
    case 'danger':
      return 'Overtraining Risk'
    case 'undertrained':
      return 'Undertrained'
    default:
      return '\u2014'
  }
}

// ── Recovery Trend ──────────────────────────────────────────────────────

/** Compute recovery score for every day in the dataset */
export function buildRecoveryTrendData(data: DailyMetric[]) {
  const avgHrv = fieldAvg(data, 'hrv_last_night_avg')
  const rhrValues = data.map((d) => d.resting_hr).filter((v): v is number => v !== null)
  const minRhr = rhrValues.length > 0 ? Math.min(...rhrValues) : null
  const maxRhr = rhrValues.length > 0 ? Math.max(...rhrValues) : null
  const avgRhr = fieldAvg(data, 'resting_hr')

  return data
    .map((d) => ({
      date: d.date,
      recovery: computeRecoveryScore(d, avgHrv, avgRhr, minRhr, maxRhr),
      sleepScore: d.sleep_score,
      bbHigh: d.bb_highest,
    }))
    .filter((d) => d.recovery !== null)
}

// ── Fitness Direction ───────────────────────────────────────────────────

/** Simple linear regression slope */
function linearSlope(values: (number | null)[]): number | null {
  const valid: [number, number][] = []
  values.forEach((v, i) => {
    if (v !== null) valid.push([i, v])
  })
  if (valid.length < 3) return null

  const n = valid.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumX2 = 0
  for (const [x, y] of valid) {
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
  }
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null
  return (n * sumXY - sumX * sumY) / denom
}

export interface FitnessDirection {
  signal: string
  label: string
  color: string
  rhrDelta: number | null
  hrvDelta: number | null
  vo2max: number | null
}

/** Compute 5-level fitness direction from RHR + HRV slopes */
export function computeFitnessDirection(data: DailyMetric[]): FitnessDirection {
  const recent = data.slice(-14)
  const rhrSlope = linearSlope(recent.map((d) => d.resting_hr))
  const hrvSlope = linearSlope(recent.map((d) => d.hrv_last_night_avg))

  const rhrImproving = rhrSlope !== null && rhrSlope < -0.05
  const hrvImproving = hrvSlope !== null && hrvSlope > 0.1
  const rhrDeclining = rhrSlope !== null && rhrSlope > 0.05
  const hrvDeclining = hrvSlope !== null && hrvSlope < -0.1

  // Summary deltas for display
  const summary = computeFitnessSummary(data)

  if (rhrImproving && hrvImproving)
    return { signal: '\u25b2\u25b2', label: 'Accelerating', color: '#00c853', ...summary }
  if ((rhrImproving || hrvImproving) && !rhrDeclining && !hrvDeclining)
    return { signal: '\u25b2', label: 'Improving', color: '#64dd17', ...summary }
  if (rhrDeclining && hrvDeclining)
    return { signal: '\u25bc\u25bc', label: 'Regressing', color: '#ff3d00', ...summary }
  if ((rhrDeclining || hrvDeclining) && !rhrImproving && !hrvImproving)
    return { signal: '\u25bc', label: 'Declining', color: '#ffd600', ...summary }
  return { signal: '\u25ba', label: 'Maintaining', color: '#78909c', ...summary }
}
