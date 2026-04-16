import dayjs from 'dayjs'
import type { ExerciseKey, MetricKey, SetType } from './types'

export const EXERCISES: { value: ExerciseKey; label: string }[] = [
  { value: 'bench_press', label: 'Bench Press' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'squat', label: 'Squat' },
  { value: 'pull_ups', label: 'Pull-ups' },
]

export const EXERCISE_COLORS: Record<ExerciseKey, string> = {
  bench_press: '#1677ff',
  deadlift: '#ff4d4f',
  squat: '#52c41a',
  pull_ups: '#fa8c16',
}

export const SET_TYPE_OPTIONS: { value: SetType; label: string }[] = [
  { value: 'warmup', label: 'Warm-up' },
  { value: 'work', label: 'Work' },
  { value: 'drop', label: 'Drop' },
]

export const METRICS: { value: MetricKey; label: string; unit: string }[] = [
  { value: 'estimated_1rm', label: 'Est. 1RM', unit: 'kg' },
  { value: 'max_weight', label: 'Max Weight', unit: 'kg' },
  { value: 'total_volume', label: 'Total Volume', unit: 'kg' },
  { value: 'total_reps', label: 'Total Reps', unit: 'reps' },
  { value: 'work_sets', label: 'Work Sets', unit: 'sets' },
  { value: 'avg_intensity', label: 'Avg Intensity', unit: '%' },
]

export const DEFAULT_DATE_FROM = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
export const DEFAULT_DATE_TO = dayjs().format('YYYY-MM-DD')

export const PULL_UPS_BODYWEIGHT = 70
