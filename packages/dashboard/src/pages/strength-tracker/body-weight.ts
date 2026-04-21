import { useEffect, useState } from 'react'
import { useList } from '@refinedev/core'
import { api } from '../../providers/eden'

export interface WeightLogEntry {
  date: string
  weight_kg: number
}


export interface UserProfile {
  gender: 'male' | 'female' | null
  goal_weight_kg: number | null
}

let _genderWarned = false

export function useUserProfile(): UserProfile | null {
  const [profile, setProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    api['user-profile']
      .get()
      .then(({ data }) => {
        if (data) {
          const gender = data.gender as 'male' | 'female' | null
          if (!gender && !_genderWarned) {
            // eslint-disable-next-line no-console
            console.warn(
              '[StrengthTracker] user_profile.gender is null — defaulting to male for DOTS. Set gender in user profile for accurate balance ratios.',
            )
            _genderWarned = true
          }
          setProfile({ gender, goal_weight_kg: data.goal_weight_kg })
        }
      })
      .catch(() => {})
  }, [])

  return profile
}

const HARD_FALLBACK_KG = 80

// Returns the best-known bodyweight for the given date using the resolution chain:
// 1. Nearest weight_log entry on-or-before date
// 2. profileDefault from user_profile (goal_weight_kg if set)
// 3. 80 kg hard fallback
export function bodyWeight(
  date: string,
  sources: {
    weightLog: WeightLogEntry[]
    profileDefault: number
  },
): number {
  const onOrBefore = sources.weightLog
    .filter((e) => e.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))

  if (onOrBefore.length > 0) return onOrBefore[0].weight_kg

  return sources.profileDefault
}

export function useBodyWeight(): (date: string) => number {
  const { result: weightLogResult } = useList<WeightLogEntry>({
    resource: 'weight-log',
    pagination: { currentPage: 1, pageSize: 500 },
    sorters: [{ field: 'date', order: 'desc' }],
  })
  const profile = useUserProfile()

  const weightLog = (weightLogResult.data as WeightLogEntry[] | undefined) ?? []
  const profileDefault = profile?.goal_weight_kg ?? HARD_FALLBACK_KG

  return (date: string) => bodyWeight(date, { weightLog, profileDefault })
}
