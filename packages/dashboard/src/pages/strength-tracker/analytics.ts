import dayjs from 'dayjs'
import type { DailyMetric } from '../garmin-health/types'
import {
  activityComponents,
  computeFitnessDirection,
  computeRecoveryScore,
  fieldAvg,
  strainDebtCeiling,
} from '../garmin-health/utils'
import type { ExerciseKey, Workout } from './types'
import {
  buildInolChartData,
  buildMomentumChartData,
  computeAcwrSeries,
  sessionInol,
  strengthDirection,
  velocityPctPerDay,
  volumeLandmarks,
  weeklyTonnageSeries,
  type AcwrResult,
} from './utils'

// ── DOTS IPF 2020 ─────────────────────────────────────────────────────────
// Formula: DOTS = lifted × 500 / (A + B·bw + C·bw² + D·bw³ + E·bw⁴)
// Constants from IPF Technical Rules 2020, verified against OpenPowerlifting
// source: https://www.powerlifting.sport/fileadmin/ipf/data/ipf-formula/IPF_DOTS_POINTS.pdf

const DOTS_MALE = {
  A: -307.75076,
  B: 24.0900756,
  C: -0.1918759221,
  D: 0.0007391293,
  E: -0.000001093,
} as const

const DOTS_FEMALE = {
  A: -57.96288,
  B: 13.6175032,
  C: -0.1126655495,
  D: 0.0005158568,
  E: -0.0000010706,
} as const

export function dotsCoefficient(bw: number, gender: 'male' | 'female'): number {
  const c = gender === 'female' ? DOTS_FEMALE : DOTS_MALE
  const denom = c.A + c.B * bw + c.C * bw ** 2 + c.D * bw ** 3 + c.E * bw ** 4
  return denom > 0 ? 500 / denom : 0
}

export function dotsAdjusted(e1rm: number, bw: number, gender: 'male' | 'female'): number {
  return e1rm * dotsCoefficient(bw, gender)
}

// ── Best 1RMs ─────────────────────────────────────────────────────────────

function bestE1RMs(workouts: Workout[], exerciseIds: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const exId of exerciseIds) {
    for (const w of workouts) {
      if (w.exercise_id !== exId || w.estimated_1rm === null) continue
      const cur = result[exId]
      result[exId] = cur === undefined ? w.estimated_1rm : Math.max(cur, w.estimated_1rm)
    }
  }
  return result
}

function maxPullUpAdded(workouts: Workout[]): number | null {
  let best: number | null = null
  for (const w of workouts) {
    if (w.exercise_id !== 'pull_ups') continue
    for (const s of w.sets) {
      if (s.set_type !== 'work' && s.set_type !== 'amrap') continue
      if (best === null || s.weight_kg > best) best = s.weight_kg
    }
  }
  return best
}

// ── Strength Ratios ───────────────────────────────────────────────────────

export type RatioStatus = 'balanced' | 'imbalanced' | 'critical'

export interface RatioPair {
  label: string
  ratio: number | null
  range: [number, number]
  status: RatioStatus | null
  scaleMax: number
}

function computeStatus(ratio: number, [lo, hi]: [number, number]): RatioStatus {
  if (ratio >= lo && ratio <= hi) return 'balanced'
  const deviation = ratio < lo ? (lo - ratio) / lo : (ratio - hi) / hi
  if (deviation > 0.3) return 'critical'
  if (deviation > 0.15) return 'imbalanced'
  return 'balanced'
}

export interface StrengthRatiosResult {
  pairs: RatioPair[]
  hasData: boolean
}

export function computeStrengthRatios(
  workouts: Workout[],
  bw: number,
  gender: 'male' | 'female',
): StrengthRatiosResult {
  const bests = bestE1RMs(workouts, ['bench_press', 'deadlift', 'squat'])
  const pullUpAdded = maxPullUpAdded(workouts)

  const dotsFor = (id: string): number | null => {
    const e1rm = bests[id]
    return e1rm !== undefined ? dotsAdjusted(e1rm, bw, gender) : null
  }

  const dlDots = dotsFor('deadlift')
  const sqDots = dotsFor('squat')
  const bpDots = dotsFor('bench_press')

  function makePair(
    label: string,
    num: number | null,
    den: number | null,
    range: [number, number],
    scaleMax: number,
  ): RatioPair {
    const ratio = num !== null && den !== null && den > 0 ? num / den : null
    return {
      label,
      ratio,
      range,
      status: ratio !== null ? computeStatus(ratio, range) : null,
      scaleMax,
    }
  }

  // Pull-up ratio uses raw added weight / BW (not DOTS-adjusted)
  // Return null if no added weight (bodyweight-only pull-ups don't apply to this ratio)
  const pullUpNum = pullUpAdded !== null && pullUpAdded > 0 ? pullUpAdded : null

  const pairs: RatioPair[] = [
    makePair('DL / Squat', dlDots, sqDots, [1.0, 1.25], 2.0),
    makePair('Squat / Bench', sqDots, bpDots, [1.2, 1.5], 2.2),
    makePair('DL / Bench', dlDots, bpDots, [1.5, 2.0], 3.0),
    makePair('Pull-up / BW', pullUpNum, bw, [0.4, 0.7], 1.2),
  ]

  return { pairs, hasData: pairs.some((p) => p.ratio !== null) }
}

// ── Balance Composite ─────────────────────────────────────────────────────

export interface BalanceResult {
  status: RatioStatus | null
  worstPair: RatioPair | null
}

export function computeBalanceComposite(ratios: StrengthRatiosResult): BalanceResult {
  const withData = ratios.pairs.filter((p) => p.status !== null)
  if (withData.length === 0) return { status: null, worstPair: null }

  const statusOrder: Record<RatioStatus, number> = { balanced: 0, imbalanced: 1, critical: 2 }
  const worst = withData.reduce<RatioPair>((best, p) => {
    if (p.status === null) return best
    if (best.status === null) return p
    return statusOrder[p.status] >= statusOrder[best.status] ? p : best
  }, withData[0]!)

  return { status: worst.status, worstPair: worst }
}

// ── Load Quality Composite ────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(100, v))
}

function inolZoneScore(inol: number): number {
  if (inol < 0.4) return 0
  if (inol < 0.6) return clamp01(((inol - 0.4) / 0.2) * 100)
  if (inol <= 1.0) return 100
  if (inol <= 1.5) return clamp01(((1.5 - inol) / 0.5) * 100)
  return 0
}

function acwrZoneScore(acwr: number): number {
  if (acwr < 0.8) return clamp01((acwr / 0.8) * 100)
  if (acwr <= 1.3) return 100
  if (acwr <= 1.5) return clamp01(((1.5 - acwr) / 0.2) * 100)
  return 0
}

function volLandmarkScore(vol: number, mev: number, mav: number, mrv: number): number {
  if (mrv <= 0 || mav <= mev) return 50
  if (vol < mev) return clamp01((vol / mev) * 100)
  if (vol <= mav) return 100
  if (vol <= mrv) return clamp01(((mrv - vol) / (mrv - mav)) * 100)
  return 0
}

export type DragComponent = 'INOL' | 'ACWR' | 'Volume'

export interface LoadQualityResult {
  score: number
  verdict: 'Quality' | 'Adequate' | 'Poor'
  dragComponent: DragComponent | null
  latestInol: number | null
  latestAcwr: number | null
}

export function computeLoadQuality(
  workouts: Workout[],
  exercises: ExerciseKey[],
): LoadQualityResult {
  const inolScores: number[] = []
  const acwrScores: number[] = []
  const volScores: number[] = []
  let latestInol: number | null = null
  let latestAcwr: number | null = null

  for (const exId of exercises) {
    const inolData = buildInolChartData(workouts, exId)
    if (inolData.length > 0) {
      const last = inolData[inolData.length - 1]!
      const inol = last.ma10 ?? last.inol
      if (inol !== null) {
        inolScores.push(inolZoneScore(inol))
        if (latestInol === null) latestInol = inol
      }
    }

    const acwrData = computeAcwrSeries(workouts, exId)
    if (acwrData.length > 0) {
      const lastAcwr = acwrData[acwrData.length - 1]!.acwr
      if (lastAcwr !== null) {
        acwrScores.push(acwrZoneScore(lastAcwr))
        if (latestAcwr === null) latestAcwr = lastAcwr
      }
    }

    const lm = volumeLandmarks(workouts, exId)
    const tonSeries = weeklyTonnageSeries(workouts, exId)
    if (tonSeries.length > 0 && lm.mrv > 0) {
      const lastTon = tonSeries[tonSeries.length - 1]!.tonnage
      volScores.push(volLandmarkScore(lastTon, lm.mev, lm.mav, lm.mrv))
    }
  }

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 50)

  const inolScore = avg(inolScores)
  const acwrScore = avg(acwrScores)
  const volScore = avg(volScores)
  const score = Math.round(0.4 * inolScore + 0.4 * acwrScore + 0.2 * volScore)

  const verdict: 'Quality' | 'Adequate' | 'Poor' =
    score >= 75 ? 'Quality' : score >= 50 ? 'Adequate' : 'Poor'

  const components = [
    { name: 'INOL' as DragComponent, score: inolScore },
    { name: 'ACWR' as DragComponent, score: acwrScore },
    { name: 'Volume' as DragComponent, score: volScore },
  ]
  const drag = components.reduce<(typeof components)[0] | null>((worst, c) => {
    if (!worst) return c
    return c.score < worst.score ? c : worst
  }, null)

  return {
    score,
    verdict,
    dragComponent: drag !== null && drag.score < 90 ? drag.name : null,
    latestInol,
    latestAcwr,
  }
}

// ── Strength Direction Hero ───────────────────────────────────────────────

export interface StrengthDirectionResult {
  direction: 'improving' | 'stable' | 'declining'
  leaderExercise: string | null
  leaderVelocityPctPerMonth: number | null
  momentumSign: 'accelerating' | 'linear' | 'decelerating'
}

export function computeStrengthDirectionHero(
  workouts: Workout[],
  exercises: ExerciseKey[],
): StrengthDirectionResult {
  let bestVelocity: number | null = null
  let leaderExercise: string | null = null

  for (const exId of exercises) {
    const vel = velocityPctPerDay(workouts, exId)
    if (vel !== null && (bestVelocity === null || vel > bestVelocity)) {
      bestVelocity = vel
      leaderExercise = exId
    }
  }

  const direction = strengthDirection(bestVelocity)

  let momentumSign: 'accelerating' | 'linear' | 'decelerating' = 'linear'
  if (leaderExercise !== null) {
    const momentumData = buildMomentumChartData(workouts, leaderExercise)
    if (momentumData.length >= 2) {
      const latest = momentumData[momentumData.length - 1]!.velocity
      const prev = momentumData[momentumData.length - 2]!.velocity
      if (latest !== null && prev !== null) {
        const diff = latest - prev
        if (diff > 0.005) momentumSign = 'accelerating'
        else if (diff < -0.005) momentumSign = 'decelerating'
      }
    }
  }

  return {
    direction,
    leaderExercise,
    leaderVelocityPctPerMonth: bestVelocity !== null ? bestVelocity * 30 : null,
    momentumSign,
  }
}

// ── Relative Progression Chart Data ──────────────────────────────────────

export interface RelProgressPoint {
  date: string
  pct: Record<string, number | null>
}

export function buildRelativeProgressionData(
  workouts: Workout[],
  exerciseIds: string[],
): RelProgressPoint[] {
  // First e1RM per exercise = 100% baseline
  const baselines: Record<string, number> = {}
  for (const exId of exerciseIds) {
    const first = workouts
      .filter((w) => w.exercise_id === exId && w.estimated_1rm !== null)
      .sort((a, b) => a.date.localeCompare(b.date))[0]
    if (first) baselines[exId] = first.estimated_1rm!
  }

  const allDates = new Set<string>()
  for (const w of workouts) {
    if (exerciseIds.includes(w.exercise_id) && w.estimated_1rm !== null) allDates.add(w.date)
  }
  const sortedDates = Array.from(allDates).sort()
  if (sortedDates.length === 0) return []

  // Best e1RM per (date, exercise)
  const byDate = new Map<string, Record<string, number>>()
  for (const w of workouts) {
    if (!exerciseIds.includes(w.exercise_id) || w.estimated_1rm === null) continue
    const entry = byDate.get(w.date) ?? {}
    const cur = entry[w.exercise_id]
    entry[w.exercise_id] = cur === undefined ? w.estimated_1rm : Math.max(cur, w.estimated_1rm)
    byDate.set(w.date, entry)
  }

  return sortedDates.map((date) => {
    const dayData = byDate.get(date) ?? {}
    const pct: Record<string, number | null> = {}
    for (const exId of exerciseIds) {
      const baseline = baselines[exId]
      const val = dayData[exId]
      if (baseline !== undefined && val !== undefined && baseline > 0) {
        pct[exId] = ((val - baseline) / baseline) * 100
      } else {
        pct[exId] = null
      }
    }
    return { date, pct }
  })
}

// ── Readiness × Strain ────────────────────────────────────────────────────

export interface ReadinessPoint {
  date: string
  readiness: number | null
  garminRecovery: number | null
  fatigueDept: number
  driver: string | null
}

function p90ofArray(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.9 * sorted.length) - 1))
  return sorted[idx] ?? null
}

/**
 * Build per-day readiness scores with fatigue-debt adjustment for strength work.
 *
 * Stacking order:
 *   1. Base: raw Garmin recovery (HRV×0.4 + sleep×0.35 + RHR×0.25, w/ Garmin strain debt)
 *   2. Strength fatigue penalty: × (1 − fatigue_debt × 0.25)  — max 25% shave
 *   3. Heavy-session dampening:  × 0.9 if last session had INOL > 1.2 within 48h
 */
export function buildReadinessStrainData(
  dailyMetrics: DailyMetric[],
  workouts: Workout[],
): ReadinessPoint[] {
  if (dailyMetrics.length === 0) return []

  const avgHrv = fieldAvg(dailyMetrics, 'hrv_last_night_avg')
  const avgRhr = fieldAvg(dailyMetrics, 'resting_hr')
  const rhrValues = dailyMetrics.map((d) => d.resting_hr).filter((v): v is number => v !== null)
  const minRhr = rhrValues.length > 0 ? Math.min(...rhrValues) : null
  const maxRhr = rhrValues.length > 0 ? Math.max(...rhrValues) : null
  const garminStrainCeiling = strainDebtCeiling(dailyMetrics)

  const dailyActivityScores = dailyMetrics.map(
    (d) =>
      activityComponents(d.steps, d.moderate_intensity_min, d.vigorous_intensity_min)?.total ??
      null,
  )

  const allInols = workouts.map((w) => sessionInol(w)).filter((v): v is number => v !== null)
  const fatigueCeiling = Math.max(1.0, p90ofArray(allInols) ?? 0)

  return dailyMetrics.map((d, i) => {
    const garminRecovery = computeRecoveryScore(
      d,
      avgHrv,
      avgRhr,
      minRhr,
      maxRhr,
      dailyActivityScores[i - 1] ?? null,
      garminStrainCeiling,
    )

    if (garminRecovery === null) {
      return { date: d.date, readiness: null, garminRecovery: null, fatigueDept: 0, driver: null }
    }

    const cutoff48h = dayjs(d.date).subtract(2, 'day').format('YYYY-MM-DD')
    const recentWorkout = workouts
      .filter((w) => w.date >= cutoff48h && w.date < d.date)
      .sort((a, b) => b.date.localeCompare(a.date))[0]

    const yesterdayInol = recentWorkout !== undefined ? (sessionInol(recentWorkout) ?? null) : null
    const fatigueDept =
      yesterdayInol !== null ? Math.max(0, Math.min(1, yesterdayInol / fatigueCeiling)) : 0

    let readiness = garminRecovery * (1 - fatigueDept * 0.25)

    const isHeavySession = yesterdayInol !== null && yesterdayInol > 1.2
    if (isHeavySession) readiness *= 0.9

    const driver = isHeavySession
      ? `Fatigue debt ${fatigueDept.toFixed(2)} · heavy session yesterday`
      : fatigueDept > 0.25
        ? `Fatigue debt ${fatigueDept.toFixed(2)} · recent session`
        : null

    return {
      date: d.date,
      readiness: Math.round(Math.max(0, Math.min(100, readiness))),
      garminRecovery,
      fatigueDept,
      driver,
    }
  })
}

// ── Training–Recovery Alignment Matrix ────────────────────────────────────

export type RecoveryRow = 'high' | 'normal' | 'low'
export type AcwrCol = 'under' | 'optimal' | 'caution'

export interface AlignmentCellData {
  recoveryRow: RecoveryRow
  acwrCol: AcwrCol
  verdict: string
  verdictType: 'good' | 'warn' | 'bad'
  dates: string[]
  count: number
  isToday: boolean
}

const CELL_VERDICTS: Record<
  RecoveryRow,
  Record<AcwrCol, { verdict: string; verdictType: 'good' | 'warn' | 'bad' }>
> = {
  high: {
    under: { verdict: 'Waste', verdictType: 'warn' },
    optimal: { verdict: 'Aligned · Push', verdictType: 'good' },
    caution: { verdict: 'Misaligned · Risk', verdictType: 'bad' },
  },
  normal: {
    under: { verdict: 'Light', verdictType: 'warn' },
    optimal: { verdict: 'Aligned', verdictType: 'good' },
    caution: { verdict: 'Overload · Risk', verdictType: 'bad' },
  },
  low: {
    under: { verdict: 'Aligned · Rest', verdictType: 'good' },
    optimal: { verdict: 'Misaligned', verdictType: 'warn' },
    caution: { verdict: 'Critical · Risk', verdictType: 'bad' },
  },
}

function recoveryRowFor(score: number): RecoveryRow {
  if (score >= 70) return 'high'
  if (score >= 40) return 'normal'
  return 'low'
}

function acwrColFor(acwr: number): AcwrCol {
  if (acwr < 0.8) return 'under'
  if (acwr <= 1.3) return 'optimal'
  return 'caution'
}

function latestAcwrBefore(series: AcwrResult[], targetDate: string): number | null {
  const candidates = series.filter((p) => p.date <= targetDate && p.acwr !== null)
  return candidates.length > 0 ? (candidates[candidates.length - 1]!.acwr ?? null) : null
}

export function buildAlignmentMatrix(
  readinessData: ReadinessPoint[],
  workouts: Workout[],
  activeExerciseIds: string[],
  today: string,
): AlignmentCellData[][] {
  const ROWS: RecoveryRow[] = ['high', 'normal', 'low']
  const COLS: AcwrCol[] = ['under', 'optimal', 'caution']

  const allAcwrSeries: AcwrResult[][] = activeExerciseIds.map((ex) =>
    computeAcwrSeries(workouts, ex),
  )

  const readinessByDate = new Map<string, number>()
  for (const r of readinessData) {
    if (r.readiness !== null) readinessByDate.set(r.date, r.readiness)
  }

  const grid: AlignmentCellData[][] = ROWS.map((row) =>
    COLS.map((col) => ({
      recoveryRow: row,
      acwrCol: col,
      verdict: CELL_VERDICTS[row][col].verdict,
      verdictType: CELL_VERDICTS[row][col].verdictType,
      dates: [],
      count: 0,
      isToday: false,
    })),
  )

  const sessionDates = new Set<string>()
  for (const w of workouts) {
    if (activeExerciseIds.includes(w.exercise_id)) sessionDates.add(w.date)
  }

  for (const date of sessionDates) {
    const recovery = readinessByDate.get(date)
    if (recovery === undefined) continue

    const acwrValues = allAcwrSeries
      .map((series) => latestAcwrBefore(series, date))
      .filter((v): v is number => v !== null)
    if (acwrValues.length === 0) continue
    const avgAcwr = acwrValues.reduce((a, b) => a + b, 0) / acwrValues.length

    const rowIdx = ROWS.indexOf(recoveryRowFor(recovery))
    const colIdx = COLS.indexOf(acwrColFor(avgAcwr))
    if (rowIdx >= 0 && colIdx >= 0) {
      grid[rowIdx]![colIdx]!.dates.push(date)
      grid[rowIdx]![colIdx]!.count++
    }
  }

  const todayRecovery = readinessByDate.get(today)
  const todayAcwrValues = allAcwrSeries
    .map((series) => latestAcwrBefore(series, today))
    .filter((v): v is number => v !== null)
  if (todayRecovery !== undefined && todayAcwrValues.length > 0) {
    const todayAvgAcwr = todayAcwrValues.reduce((a, b) => a + b, 0) / todayAcwrValues.length
    const rowIdx = ROWS.indexOf(recoveryRowFor(todayRecovery))
    const colIdx = COLS.indexOf(acwrColFor(todayAvgAcwr))
    if (rowIdx >= 0 && colIdx >= 0) {
      grid[rowIdx]![colIdx]!.isToday = true
    }
  }

  return grid
}

// ── Deload Signal ─────────────────────────────────────────────────────────

export interface DeloadSignalResult {
  verdict: 'deload' | 'monitor' | 'progress'
  activeSignals: string[]
  physioAvailable: boolean
}

export function deloadSignal(
  workouts: Workout[],
  dailyMetrics: DailyMetric[],
  activeExerciseIds: string[],
  today: string,
): DeloadSignalResult {
  const physioAvailable = dailyMetrics.length >= 7
  const signals: string[] = []

  // Signal 1: Stall — velocity ≤ 0 on ≥ 2 key lifts with recent sessions (last 21d)
  const cutoff21 = dayjs(today).subtract(21, 'day').format('YYYY-MM-DD')
  let stalledLifts = 0
  for (const exId of activeExerciseIds) {
    const vel = velocityPctPerDay(workouts, exId)
    const hasRecent = workouts.some((w) => w.exercise_id === exId && w.date >= cutoff21)
    if (vel !== null && vel <= 0 && hasRecent) stalledLifts++
  }
  if (stalledLifts >= 2) signals.push(`stall on ${stalledLifts} lifts`)

  // Signal 2: Overload — last 2 ACWR weekly points > 1.3 on ≥ 1 key lift
  let signaled = false
  for (const exId of activeExerciseIds) {
    if (signaled) break
    const acwrData = computeAcwrSeries(workouts, exId)
    if (acwrData.length >= 2) {
      const last2 = acwrData.slice(-2)
      if (last2.every((p) => p.acwr !== null && p.acwr > 1.3)) {
        signals.push(`overload (${exId} ACWR ${last2[last2.length - 1]!.acwr!.toFixed(2)})`)
        signaled = true
      }
    }
  }

  // Signal 3: Fatigue — avg INOL > 1.1 over last 10 sessions across active exercises
  const recentSessions = workouts
    .filter((w) => activeExerciseIds.includes(w.exercise_id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)
  if (recentSessions.length >= 5) {
    const inols = recentSessions.map((w) => sessionInol(w)).filter((v): v is number => v !== null)
    const avgInol = inols.length > 0 ? inols.reduce((a, b) => a + b, 0) / inols.length : 0
    if (avgInol > 1.1) signals.push(`fatigue (INOL avg ${avgInol.toFixed(2)})`)
  }

  // Signal 4: Physio — declining fitness direction OR HRV 7d MA down > 15% vs 28d baseline
  if (physioAvailable) {
    const sorted = [...dailyMetrics].sort((a, b) => a.date.localeCompare(b.date))
    const fitnessDir = computeFitnessDirection(sorted)
    if (fitnessDir.label === 'Declining') {
      signals.push('physio (fitness declining)')
    } else {
      const last7Hrv = sorted
        .slice(-7)
        .map((d) => d.hrv_last_night_avg)
        .filter((v): v is number => v !== null)
      const last28Hrv = sorted
        .slice(-28)
        .map((d) => d.hrv_last_night_avg)
        .filter((v): v is number => v !== null)
      if (last7Hrv.length >= 3 && last28Hrv.length >= 7) {
        const hrv7avg = last7Hrv.reduce((a, b) => a + b, 0) / last7Hrv.length
        const hrv28avg = last28Hrv.reduce((a, b) => a + b, 0) / last28Hrv.length
        if (hrv28avg > 0 && hrv7avg < hrv28avg * 0.85) {
          signals.push(`physio (HRV down ${Math.round((1 - hrv7avg / hrv28avg) * 100)}%)`)
        }
      }
    }
  }

  const count = signals.length
  const verdict: 'deload' | 'monitor' | 'progress' =
    count >= 2 ? 'deload' : count === 1 ? 'monitor' : 'progress'

  return { verdict, activeSignals: signals, physioAvailable }
}
