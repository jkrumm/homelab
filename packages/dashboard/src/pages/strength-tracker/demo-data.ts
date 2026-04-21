import dayjs from 'dayjs'
import type { ExerciseKey, Workout, WorkoutSet } from './types'
import { estimate1RM } from './utils'

const PULL_UPS_BW = 80

function calcTotalVolume(
  sets: { set_type: string; weight_kg: number; reps: number }[],
  exercise: ExerciseKey,
): number {
  return sets.reduce((sum, s) => {
    const w = exercise === 'pull_ups' ? s.weight_kg + PULL_UPS_BW : s.weight_kg
    return sum + w * s.reps
  }, 0)
}

function jitter(value: number, range: number): number {
  return value + (Math.random() * range * 2 - range)
}

function round(value: number, step: number): number {
  return Math.round(value / step) * step
}

export function generateDemoWorkouts(): Workout[] {
  const today = dayjs()
  const startDate = today.subtract(180, 'day')

  const baseWeights: Record<ExerciseKey, number> = {
    bench_press: 60,
    deadlift: 100,
    squat: 80,
    pull_ups: 10,
  }

  const exercises: ExerciseKey[] = ['bench_press', 'deadlift', 'squat', 'pull_ups']
  const workouts: Workout[] = []
  let idCounter = 1000
  let setIdCounter = 5000

  const sessionDays: string[] = []

  let current = startDate
  while (!current.isAfter(today)) {
    const dayOfWeek = current.day()
    // Mon/Wed/Fri/Sat — 4 days per week
    if ([1, 3, 5, 6].includes(dayOfWeek)) {
      sessionDays.push(current.format('YYYY-MM-DD'))
    }
    current = current.add(1, 'day')
  }

  let exerciseIdx = 0

  for (let i = 0; i < sessionDays.length; i++) {
    const date = sessionDays[i]
    const ex = exercises[exerciseIdx % exercises.length]
    exerciseIdx++

    // Increment weight every ~3 sessions per exercise (every 12th session across cycle)
    const sessionsForThisExercise = Math.floor(i / 4)
    const incrementsApplied = Math.floor(sessionsForThisExercise / 3)
    const isDeload = sessionsForThisExercise % 18 === 17

    const baseWeight = baseWeights[ex] + incrementsApplied * 2.5
    const sessionWeight = isDeload
      ? round(baseWeight * 0.8, 2.5)
      : round(jitter(baseWeight, 1.25), 2.5)

    const sets: Omit<WorkoutSet, 'id' | 'workout_id' | 'created_at'>[] = []

    // 1-2 warmup sets
    const warmupCount = Math.random() > 0.5 ? 2 : 1
    for (let w = 0; w < warmupCount; w++) {
      const warmupWeight = round(sessionWeight * (w === 0 ? 0.5 : 0.7), 2.5)
      sets.push({
        set_number: sets.length + 1,
        set_type: 'warmup',
        weight_kg: warmupWeight,
        reps: 5,
      })
    }

    // 3-5 work sets
    const workCount = isDeload ? 3 : Math.floor(Math.random() * 3) + 3
    const workReps = Math.floor(Math.random() * 6) + 3 // 3-8 reps
    for (let w = 0; w < workCount; w++) {
      sets.push({
        set_number: sets.length + 1,
        set_type: 'work',
        weight_kg: sessionWeight,
        reps: workReps,
      })
    }

    // Occasional drop set
    if (!isDeload && Math.random() > 0.7) {
      sets.push({
        set_number: sets.length + 1,
        set_type: 'drop',
        weight_kg: round(sessionWeight * 0.8, 2.5),
        reps: workReps + 2,
      })
    }

    const fullSets: WorkoutSet[] = sets.map((s) => ({
      ...s,
      id: setIdCounter++,
      workout_id: idCounter,
      created_at: null,
    }))

    const isPullUps = ex === 'pull_ups'
    const workSets = sets.filter((s) => s.set_type === 'work')
    let best1rm: number | null = null
    for (const s of workSets) {
      const ew = isPullUps ? s.weight_kg + PULL_UPS_BW : s.weight_kg
      const val = estimate1RM(ew, s.reps)
      if (val !== null && (best1rm === null || val > best1rm)) best1rm = val
    }
    const estimated_1rm_val =
      workSets.length > 0 && best1rm !== null ? Math.round(best1rm * 10) / 10 : null

    const workout: Workout = {
      id: idCounter++,
      date,
      exercise_id: ex,
      rir: null,
      notes: null,
      created_at: null,
      sets: fullSets,
      estimated_1rm_epley: null,
      estimated_1rm_brzycki: null,
      estimated_1rm: estimated_1rm_val,
      total_volume: calcTotalVolume(sets, ex),
    }

    workouts.push(workout)
  }

  return workouts.sort((a, b) => a.date.localeCompare(b.date))
}
