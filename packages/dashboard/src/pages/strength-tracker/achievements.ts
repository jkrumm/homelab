import confetti from 'canvas-confetti'
import { EXERCISES } from './constants'
import type { ExerciseKey, Workout } from './types'
import { computeWorkoutMetrics } from './utils'

export interface Achievement {
  type: 'first_workout' | 'weight_milestone' | 'max_weight_pr' | 'estimated_1rm_pr' | 'volume_pr'
  title: string
  description: string
  confetti: boolean
}

export function detectAchievements(
  exercise: ExerciseKey,
  sets: { set_type: string; weight_kg: number; reps: number }[],
  historicalWorkouts: Workout[],
): Achievement[] {
  const achievements: Achievement[] = []
  const exLabel = EXERCISES.find((e) => e.value === exercise)?.label ?? exercise
  const history = historicalWorkouts.filter((w) => w.exercise_id === exercise)
  const { maxWeight, estimated1rm, totalVolume } = computeWorkoutMetrics(sets, exercise)

  if (maxWeight === 0) return achievements

  // First workout for this exercise — single combined celebration
  if (history.length === 0) {
    const parts = [`${maxWeight}kg top set`]
    if (estimated1rm !== null && estimated1rm > 0)
      parts.push(`${estimated1rm.toFixed(1)}kg est. 1RM`)
    parts.push(`${Math.round(totalVolume).toLocaleString()}kg volume`)
    achievements.push({
      type: 'first_workout',
      title: `First ${exLabel} Workout!`,
      description: parts.join(', '),
      confetti: true,
    })
    return achievements
  }

  const isPullUps = exercise === 'pull_ups'
  const PULL_UPS_BW = 80

  // Historical bests
  const prevMaxWeight =
    history.length > 0
      ? Math.max(
          0,
          ...history.map((w) => {
            const ws = w.sets.filter((s) => s.set_type === 'work')
            if (ws.length === 0) return 0
            return Math.max(...ws.map((s) => (isPullUps ? s.weight_kg + PULL_UPS_BW : s.weight_kg)))
          }),
        )
      : 0

  const prevMax1rm =
    history.length > 0
      ? Math.max(0, ...history.filter((w) => w.estimated_1rm !== null).map((w) => w.estimated_1rm!))
      : 0

  const prevMaxVolume = history.length > 0 ? Math.max(0, ...history.map((w) => w.total_volume)) : 0

  // Weight milestones (crossing round number boundaries)
  const step = isPullUps ? 5 : 10
  const prevMilestone = Math.floor(prevMaxWeight / step) * step
  const newMilestone = Math.floor(maxWeight / step) * step
  if (newMilestone > prevMilestone) {
    achievements.push({
      type: 'weight_milestone',
      title: `${newMilestone}kg Milestone!`,
      description: `${exLabel} crossed the ${newMilestone}kg mark`,
      confetti: newMilestone % 50 === 0,
    })
  }

  // New max weight PR
  if (maxWeight > prevMaxWeight && prevMaxWeight > 0) {
    achievements.push({
      type: 'max_weight_pr',
      title: 'New Max Weight PR!',
      description: `${exLabel} \u2014 ${maxWeight}kg (prev ${prevMaxWeight}kg)`,
      confetti: true,
    })
  }

  // New estimated 1RM PR
  if (estimated1rm !== null && estimated1rm > prevMax1rm && prevMax1rm > 0) {
    achievements.push({
      type: 'estimated_1rm_pr',
      title: 'New Estimated 1RM!',
      description: `${exLabel} \u2014 ${estimated1rm}kg (prev ${prevMax1rm.toFixed(1)}kg)`,
      confetti: true,
    })
  }

  // New volume PR
  if (totalVolume > prevMaxVolume && prevMaxVolume > 0) {
    achievements.push({
      type: 'volume_pr',
      title: 'New Volume Record!',
      description: `${exLabel} \u2014 ${Math.round(totalVolume).toLocaleString()}kg total (prev ${Math.round(prevMaxVolume).toLocaleString()}kg)`,
      confetti: false,
    })
  }

  return achievements
}

export function fireConfetti() {
  confetti({ particleCount: 80, spread: 70, origin: { y: 0.6, x: 0.5 } })
  setTimeout(() => {
    confetti({ particleCount: 40, angle: 60, spread: 55, origin: { x: 0, y: 0.65 } })
    confetti({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1, y: 0.65 } })
  }, 200)
}
