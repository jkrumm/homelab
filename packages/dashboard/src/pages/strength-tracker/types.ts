export interface Exercise {
  id: string
  name: string
  category: string
  muscle_group: string
  is_bodyweight: number | null
  display_order: number | null
}

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
  exercise_id: string
  exercise_name?: string | null
  is_bodyweight?: number | null
  rir: number | null
  notes: string | null
  created_at: string | null
  sets: WorkoutSet[]
  estimated_1rm_epley: number | null
  estimated_1rm_brzycki: number | null
  estimated_1rm: number | null
  total_volume: number
}

export type ExerciseKey = 'bench_press' | 'deadlift' | 'squat' | 'pull_ups'
export type SetType = 'warmup' | 'work' | 'drop' | 'amrap'
export type MetricKey =
  | 'max_weight'
  | 'estimated_1rm'
  | 'total_volume'
  | 'total_reps'
  | 'work_sets'
  | 'avg_intensity'

export type AcwrZone = 'undertrained' | 'optimal' | 'caution' | 'danger'

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
