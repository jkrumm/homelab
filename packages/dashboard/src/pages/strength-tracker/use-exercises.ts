import { useList } from '@refinedev/core'
import { EXERCISES } from './constants'
import type { Exercise, ExerciseKey } from './types'

const FALLBACK: Exercise[] = EXERCISES.map((e, i) => ({
  id: e.value,
  name: e.label,
  category:
    e.value === 'bench_press'
      ? 'push'
      : e.value === 'pull_ups'
        ? 'pull'
        : e.value === 'squat'
          ? 'legs'
          : 'hinge',
  muscle_group:
    e.value === 'bench_press'
      ? 'chest'
      : e.value === 'pull_ups'
        ? 'back'
        : e.value === 'squat'
          ? 'quads'
          : 'posterior',
  is_bodyweight: e.value === 'pull_ups' ? 1 : 0,
  display_order: i + 1,
}))

export function useExercises(): { exercises: Exercise[]; isLoading: boolean } {
  const { result, query } = useList<Exercise>({
    resource: 'exercises',
    pagination: { currentPage: 1, pageSize: 50 },
  })

  const exercises = (result.data as Exercise[] | undefined) ?? []
  return {
    exercises: exercises.length > 0 ? exercises : FALLBACK,
    isLoading: query.isLoading,
  }
}

export function exerciseOptions(exercises: Exercise[]): { value: string; label: string }[] {
  return exercises.map((e) => ({ value: e.id, label: e.name }))
}

export const EXERCISE_KEYS: ExerciseKey[] = ['bench_press', 'deadlift', 'squat', 'pull_ups']
