import confetti from 'canvas-confetti'
import { EXERCISES, PULL_UPS_BODYWEIGHT } from './constants'
import type { ExerciseKey, Workout } from './types'

export interface Achievement {
  type: 'weight_milestone' | 'max_weight_pr' | 'estimated_1rm_pr' | 'volume_pr'
  title: string
  description: string
  confetti: boolean
}

function computeClientMetrics(
  sets: { set_type: string; weight_kg: number; reps: number }[],
  exercise: ExerciseKey,
) {
  const isPullUps = exercise === 'pull_ups'
  const workSets = sets.filter((s) => s.set_type === 'work')

  const maxWeight =
    workSets.length > 0
      ? Math.max(
          ...workSets.map((s) => (isPullUps ? s.weight_kg + PULL_UPS_BODYWEIGHT : s.weight_kg)),
        )
      : 0

  let maxEpley = 0
  let maxBrzycki = 0
  for (const s of workSets) {
    const ew = isPullUps ? s.weight_kg + PULL_UPS_BODYWEIGHT : s.weight_kg
    maxEpley = Math.max(maxEpley, ew * (1 + s.reps / 30))
    if (s.reps < 37) {
      maxBrzycki = Math.max(maxBrzycki, (ew * 36) / (37 - s.reps))
    }
  }
  const estimated1rm =
    workSets.length > 0 && maxBrzycki > 0
      ? Math.round(((maxEpley + maxBrzycki) / 2) * 10) / 10
      : Math.round(maxEpley * 10) / 10

  let totalVolume = 0
  for (const s of sets) {
    const ew = isPullUps ? s.weight_kg + PULL_UPS_BODYWEIGHT : s.weight_kg
    totalVolume += ew * s.reps
  }

  return { maxWeight, estimated1rm, totalVolume }
}

export function detectAchievements(
  exercise: ExerciseKey,
  sets: { set_type: string; weight_kg: number; reps: number }[],
  historicalWorkouts: Workout[],
): Achievement[] {
  const achievements: Achievement[] = []
  const exLabel = EXERCISES.find((e) => e.value === exercise)?.label ?? exercise
  const history = historicalWorkouts.filter((w) => w.exercise === exercise)
  const { maxWeight, estimated1rm, totalVolume } = computeClientMetrics(sets, exercise)

  if (maxWeight === 0) return achievements

  const isPullUps = exercise === 'pull_ups'

  // Historical bests
  const prevMaxWeight =
    history.length > 0
      ? Math.max(
          0,
          ...history.map((w) => {
            const ws = w.sets.filter((s) => s.set_type === 'work')
            if (ws.length === 0) return 0
            return Math.max(
              ...ws.map((s) => (isPullUps ? s.weight_kg + PULL_UPS_BODYWEIGHT : s.weight_kg)),
            )
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
  if (estimated1rm > prevMax1rm && prevMax1rm > 0) {
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
