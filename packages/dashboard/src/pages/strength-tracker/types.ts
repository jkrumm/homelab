export interface WorkoutSet {
  id: number
  workout_id: number
  set_number: number
  set_type: string
  weight_kg: number
  reps: number
  created_at: string | null
}

export interface Workout {
  id: number
  date: string
  exercise: ExerciseKey
  notes: string | null
  created_at: string | null
  sets: WorkoutSet[]
  estimated_1rm_epley: number | null
  estimated_1rm_brzycki: number | null
  estimated_1rm: number | null
  total_volume: number
}

export type ExerciseKey = 'bench_press' | 'deadlift' | 'squat' | 'pull_ups'
export type SetType = 'warmup' | 'work' | 'drop'
export type MetricKey =
  | 'max_weight'
  | 'estimated_1rm'
  | 'total_volume'
  | 'total_reps'
  | 'work_sets'
  | 'avg_intensity'

export interface SetEntry {
  set_type: SetType
  weight_kg: number
  reps: number
  confirmed?: boolean
}

export interface ChartDataPoint {
  date: string
  [key: string]: number | string
}
