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

/** Nearest-rank percentile of a numeric array (0–1). Returns null if empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]!
}

/** Sample standard deviation. Returns null if < 2 values. */
function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sq = values.reduce((a, v) => a + (v - mean) * (v - mean), 0)
  return Math.sqrt(sq / (values.length - 1))
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

/**
 * Minimum ceiling for the strain-debt anchor — keeps the penalty meaningful
 * on users who don't yet have a "hard day" in their history. 500 MET-min is
 * ~80% of the daily target (600), i.e. a genuinely active day.
 */
export const STRAIN_DEBT_MIN_CEILING = 500

/** Max proportional penalty applied to recovery at the ceiling (30% shave). */
export const STRAIN_DEBT_MAX_PENALTY = 0.3

/**
 * Dynamic strain-debt ceiling — 90th percentile of the user's Activity Scores
 * over the current window, floored at STRAIN_DEBT_MIN_CEILING. A "hard day
 * for YOU" becomes the anchor instead of a hardcoded 1000 MET-min.
 */
export function strainDebtCeiling(data: DailyMetric[]): number {
  const scores = data
    .map(
      (d) =>
        activityComponents(d.steps, d.moderate_intensity_min, d.vigorous_intensity_min)?.total ??
        null,
    )
    .filter((v): v is number => v !== null && v > 0)
  const p90 = percentile(scores, 0.9)
  return Math.max(STRAIN_DEBT_MIN_CEILING, p90 ?? STRAIN_DEBT_MIN_CEILING)
}

/**
 * Compute recovery score (0–100) from HRV, sleep score, and RHR, with an
 * optional strain-debt penalty based on yesterday's Activity Score.
 *
 * strain_debt = clamp(0, 1, yesterday_score / ceiling)
 * recovery    = recovery_raw × (1 − strain_debt × STRAIN_DEBT_MAX_PENALTY)
 *
 * `ceiling` defaults to 1000 for back-compat but is typically supplied via
 * `strainDebtCeiling(data)` so the penalty reflects the user's own "hard day".
 * Rest days or missing yesterday-score → no penalty.
 */
export function computeRecoveryScore(
  metric: DailyMetric,
  avgHrv: number | null,
  avgRhr: number | null,
  minRhr: number | null,
  maxRhr: number | null,
  yesterdayScore: number | null = null,
  ceiling: number = 1000,
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

  if (weight === 0) return null
  const raw = score / weight
  const safeCeiling = Math.max(1, ceiling)
  const strainDebt =
    yesterdayScore === null ? 0 : Math.max(0, Math.min(1, yesterdayScore / safeCeiling))
  return Math.round(raw * (1 - strainDebt * STRAIN_DEBT_MAX_PENALTY))
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

/** Build body battery chart data — energy balance (charged vs drained) */
export function buildBodyBatteryData(data: DailyMetric[]) {
  return data
    .filter((d) => d.bb_charged !== null || d.bb_drained !== null)
    .map((d) => ({
      date: d.date,
      charged: d.bb_charged,
      drained: d.bb_drained,
      net: d.bb_charged !== null && d.bb_drained !== null ? d.bb_charged - d.bb_drained : null,
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
      sleepStress: d.avg_sleep_stress,
    }))
}

/**
 * Daily Activity Score — MET-minutes accumulated across vigorous, moderate, and walking
 * (residual steps not already counted as intensity).
 *
 * MET multipliers per Compendium of Physical Activities (Ainsworth et al. 2011):
 *   vigorous = 8 MET (midpoint of vigorous range 6–10+)
 *   moderate = 4 MET (midpoint of moderate range 3–6)
 *   walking  = 3 MET (typical brisk pace ~100 steps/min → 0.03 MET-min per step)
 *
 * Steps are de-double-counted: each intensity minute is assumed to consume ~100 steps,
 * those steps are subtracted before the walking MET-min contribution is added.
 *
 * Daily target: 600 MET-min/day (~3.5× the WHO weekly floor of 500–1000 MET-min/week,
 * appropriate for a sportive young adult). 1 vigorous minute earns 8 MET-min, so a
 * 45 vig + 10k steps day lands ~540 — close to target without any moderate work.
 */
export const ACTIVITY_TARGET_SCORE = 600 // MET-min per day → "100% day"
const STEPS_PER_INTENSITY_MIN = 100
const STEPS_MET_PER_STEP = 0.03 // ≈ 3 MET × 1 min per 100 steps
const MODERATE_MET = 4
const VIGOROUS_MET = 8

export type ActivityComponents = {
  vigorousScore: number
  moderateScore: number
  walkingScore: number
  walkingSteps: number
  total: number
}

export function activityComponents(
  steps: number | null,
  moderateMin: number | null,
  vigorousMin: number | null,
): ActivityComponents | null {
  if (steps === null && moderateMin === null && vigorousMin === null) return null
  const mod = moderateMin ?? 0
  const vig = vigorousMin ?? 0
  const totalSteps = steps ?? 0
  const intensitySteps = (mod + vig) * STEPS_PER_INTENSITY_MIN
  const walkingSteps = Math.max(0, totalSteps - intensitySteps)
  const vigorousScore = vig * VIGOROUS_MET
  const moderateScore = mod * MODERATE_MET
  const walkingScore = walkingSteps * STEPS_MET_PER_STEP
  return {
    vigorousScore,
    moderateScore,
    walkingScore,
    walkingSteps,
    total: vigorousScore + moderateScore + walkingScore,
  }
}

/** Build activity chart data — stacked Activity Score components + 30d trend */
export function buildActivityData(data: DailyMetric[]) {
  const componentsArr = data.map((d) =>
    activityComponents(d.steps, d.moderate_intensity_min, d.vigorous_intensity_min),
  )
  const scoreMA = movingAverage(
    componentsArr.map((c) => c?.total ?? null),
    30,
  )
  return data
    .map((d, i) => {
      const c = componentsArr[i]
      return {
        date: d.date,
        steps: d.steps,
        moderateMin: d.moderate_intensity_min,
        vigorousMin: d.vigorous_intensity_min,
        walkingSteps: c?.walkingSteps ?? 0,
        vigorousScore: c?.vigorousScore ?? 0,
        moderateScore: c?.moderateScore ?? 0,
        walkingScore: c?.walkingScore ?? 0,
        score: c?.total ?? null,
        scoreMA: scoreMA[i] ?? null,
      }
    })
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

/**
 * Build fitness progression data — 7-day moving averages plus personal
 * z-scores (how far each day is from the user's own baseline, in σ units).
 *
 * RHR z-score is FLIPPED so "better" always means "higher". Result: all three
 * series (rhrZ, hrvZ, vo2Z) share a single y-axis where up = improving.
 */
export function buildFitnessData(data: DailyMetric[]) {
  const rhrMA = movingAverage(
    data.map((d) => d.resting_hr),
    7,
  )
  const hrvMA = movingAverage(
    data.map((d) => d.hrv_last_night_avg),
    7,
  )

  const rhrMAVals = rhrMA.filter((v): v is number => v !== null)
  const hrvMAVals = hrvMA.filter((v): v is number => v !== null)
  const vo2Vals = data.map((d) => d.vo2_max).filter((v): v is number => v !== null)

  const rhrMean = rhrMAVals.length ? rhrMAVals.reduce((a, b) => a + b, 0) / rhrMAVals.length : null
  const hrvMean = hrvMAVals.length ? hrvMAVals.reduce((a, b) => a + b, 0) / hrvMAVals.length : null
  const vo2Mean = vo2Vals.length ? vo2Vals.reduce((a, b) => a + b, 0) / vo2Vals.length : null

  // Floor SD at a small value so near-constant series don't produce Infinity z-scores.
  const rhrSd = Math.max(sampleStdDev(rhrMAVals) ?? 0, 0.5)
  const hrvSd = Math.max(sampleStdDev(hrvMAVals) ?? 0, 1)
  const vo2Sd = Math.max(sampleStdDev(vo2Vals) ?? 0, 0.2)

  const z = (v: number | null, mean: number | null, sd: number, flip = false): number | null => {
    if (v === null || mean === null) return null
    const raw = (v - mean) / sd
    return flip ? -raw : raw
  }

  return data
    .map((d, i) => ({
      date: d.date,
      rhrMA: rhrMA[i],
      hrvMA: hrvMA[i],
      rhr: d.resting_hr,
      hrv: d.hrv_last_night_avg,
      vo2max: d.vo2_max,
      rhrZ: z(rhrMA[i] ?? null, rhrMean, rhrSd, true),
      hrvZ: z(hrvMA[i] ?? null, hrvMean, hrvSd),
      vo2Z: z(d.vo2_max, vo2Mean, vo2Sd),
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
 * Daily load is the Daily Activity Score (MET-min, see `activityComponents`):
 *   load = walking_score + moderate_score + vigorous_score
 * This matches the effort metric shown on the Activity card, so the entire page
 * shares one definition of "effort".
 *
 * EWMA decay rates (Hulin et al. 2017, BJSM):
 *   λ_acute  = 2/(7+1)  = 0.25   (~7-day half-life)
 *   λ_chronic = 2/(28+1) ≈ 0.069  (~28-day half-life)
 *
 * Zones (Gabbett 2016, BJSM) — ratio is scale-invariant, so zone thresholds
 * survive the change from TRIMP-style to MET-min:
 *   <0.8 undertrained | 0.8-1.3 optimal | 1.3-1.5 caution | >1.5 danger
 */
export function computeTrainingLoad(data: DailyMetric[]): TrainingLoadPoint[] {
  if (data.length === 0) return []

  const λA = 2 / (7 + 1)
  const λC = 2 / (28 + 1)

  const dailyLoads = data.map(
    (d) =>
      activityComponents(d.steps, d.moderate_intensity_min, d.vigorous_intensity_min)?.total ?? 0,
  )

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

  const dailyScores = data.map(
    (d) =>
      activityComponents(d.steps, d.moderate_intensity_min, d.vigorous_intensity_min)?.total ??
      null,
  )
  const ceiling = strainDebtCeiling(data)

  return data
    .map((d, i) => ({
      date: d.date,
      recovery: computeRecoveryScore(
        d,
        avgHrv,
        avgRhr,
        minRhr,
        maxRhr,
        dailyScores[i - 1] ?? null,
        ceiling,
      ),
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

/**
 * Compute 3-level fitness direction from RHR + HRV slopes over the last 14 days.
 * Thresholds: RHR slope < -0.05 bpm/day or HRV slope > 0.1 ms/day = positive;
 * opposite = negative. Conflicting or flat signals = Stable.
 */
export function computeFitnessDirection(data: DailyMetric[]): FitnessDirection {
  const recent = data.slice(-14)
  const rhrSlope = linearSlope(recent.map((d) => d.resting_hr))
  const hrvSlope = linearSlope(recent.map((d) => d.hrv_last_night_avg))

  const rhrPositive = rhrSlope !== null && rhrSlope < -0.05
  const hrvPositive = hrvSlope !== null && hrvSlope > 0.1
  const rhrNegative = rhrSlope !== null && rhrSlope > 0.05
  const hrvNegative = hrvSlope !== null && hrvSlope < -0.1

  const hasPositive = rhrPositive || hrvPositive
  const hasNegative = rhrNegative || hrvNegative

  const summary = computeFitnessSummary(data)

  if (hasPositive && !hasNegative)
    return { signal: '\u25b2', label: 'Improving', color: '#00c853', ...summary }
  if (hasNegative && !hasPositive)
    return { signal: '\u25bc', label: 'Declining', color: '#ff3d00', ...summary }
  return { signal: '\u25ba', label: 'Stable', color: '#78909c', ...summary }
}
