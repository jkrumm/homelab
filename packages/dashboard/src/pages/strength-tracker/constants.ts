import dayjs from 'dayjs'
import { VX } from '../../charts/tokens'
import type { AcwrZone, ExerciseKey, MetricKey, SetType } from './types'

export const EXERCISES: { value: ExerciseKey; label: string }[] = [
  { value: 'bench_press', label: 'Bench Press' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'squat', label: 'Squat' },
  { value: 'pull_ups', label: 'Pull-ups' },
]

export const EXERCISE_COLORS: Record<ExerciseKey, string> = {
  bench_press: VX.series.benchPress,
  deadlift: VX.series.deadlift,
  squat: VX.series.squat,
  pull_ups: VX.series.pullUps,
}

export function colorForExercise(id: string): string {
  return (EXERCISE_COLORS as Record<string, string>)[id] ?? VX.series.acwr
}

export const METRIC_TOOLTIPS = {
  oneRmTrend:
    'Estimated 1-rep max per session using Brzycki + Epley average. Only work/AMRAP sets with ≤3 RIR and 1–12 reps count. Dashed line = 30-day moving average. Stars = personal records. Direction arrow (▲►▼) from 28-day linear regression of e1RM.',
  strengthComposite:
    "Three independent signals z-scored to your own 90-day baseline. Velocity (f'): e1RM growth rate. Tonnage growth: weekly volume vs 28-day MA. INOL quality: session load index (0.6–1.0 = optimal). All on a shared σ axis — up means above your own average.",
  weeklyVolume:
    'Weekly tonnage (weight × reps) broken down by set type. Dashed line = 4-week moving average. Ref lines: MEV (p25), MAV (p50), MRV (p90) computed from 90-day window — use as rough volume landmarks.',
  trainingLoad:
    'Acute:chronic workload ratio — 4-week vs 16-week EWMA of weekly tonnage per exercise. Green zone (0.8–1.3) = optimal adaptation stimulus. Below 0.8 = undertrained. 1.3–1.5 = caution. Above 1.5 = injury risk.',
  inol: 'INOL (Intensity × Number Of Lifts) = Σ reps / (100 − %1RM) per session. Optimal zone 0.6–1.0. Below is underdosing, above is high CNS fatigue. Only work/AMRAP sets with 1–12 reps and ≤3 RIR count.',
  momentum:
    'e1RM trend with 8-session moving average (top). Velocity (%/day, 28-day linear regression) in the bottom panel — green bars = positive trend, red = decline.',
} as const

export function acwrZoneColor(zone: AcwrZone): string {
  switch (zone) {
    case 'undertrained':
      return 'rgba(22, 119, 255, 0.15)'
    case 'optimal':
      return VX.good
    case 'caution':
      return VX.warn
    case 'danger':
      return VX.bad
  }
}

export function acwrZoneLabel(zone: AcwrZone): string {
  switch (zone) {
    case 'undertrained':
      return 'Undertrained'
    case 'optimal':
      return 'Optimal'
    case 'caution':
      return 'Caution'
    case 'danger':
      return 'Danger'
  }
}

export function inolDotColor(inol: number): string {
  if (inol < 0.4) return VX.series.acwr
  if (inol < 0.6) return VX.warnSolid
  if (inol <= 1.0) return VX.goodSolid
  if (inol <= 1.5) return VX.series.calories
  return VX.badSolid
}

export const SET_TYPE_OPTIONS: { value: SetType; label: string }[] = [
  { value: 'warmup', label: 'Warm-up' },
  { value: 'work', label: 'Work' },
  { value: 'drop', label: 'Drop' },
  { value: 'amrap', label: 'AMRAP' },
]

export const METRICS: { value: MetricKey; label: string; unit: string }[] = [
  { value: 'estimated_1rm', label: 'Est. 1RM', unit: 'kg' },
  { value: 'max_weight', label: 'Max Weight', unit: 'kg' },
  { value: 'total_volume', label: 'Total Volume', unit: 'kg' },
  { value: 'total_reps', label: 'Total Reps', unit: 'reps' },
  { value: 'work_sets', label: 'Work Sets', unit: 'sets' },
  { value: 'avg_intensity', label: 'Avg Intensity', unit: '%' },
]

export type DatePreset = '3m' | '6m' | '1y' | 'ytd' | 'all' | 'custom'

export const DATE_PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
]

export function getDateRange(preset: DatePreset, customRange: [string, string]): [string, string] {
  const today = dayjs().format('YYYY-MM-DD')
  switch (preset) {
    case '3m':
      return [dayjs().subtract(3, 'month').format('YYYY-MM-DD'), today]
    case '6m':
      return [dayjs().subtract(6, 'month').format('YYYY-MM-DD'), today]
    case '1y':
      return [dayjs().subtract(1, 'year').format('YYYY-MM-DD'), today]
    case 'ytd':
      return [dayjs().startOf('year').format('YYYY-MM-DD'), today]
    case 'all':
      return ['2000-01-01', today]
    case 'custom':
      return customRange
  }
}
