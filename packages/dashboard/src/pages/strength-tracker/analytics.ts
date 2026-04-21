import type { ExerciseKey, Workout } from './types'
import {
  buildInolChartData,
  buildMomentumChartData,
  computeAcwrSeries,
  strengthDirection,
  velocityPctPerDay,
  volumeLandmarks,
  weeklyTonnageSeries,
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
