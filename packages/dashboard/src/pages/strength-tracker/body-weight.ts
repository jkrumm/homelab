import { useList, useOne } from '@refinedev/core'

export interface WeightLogEntry {
  date: string
  weight_kg: number
}

export interface DailyMetricEntry {
  date: string
  // weight_kg is not currently in the daily_metrics schema; reserved for future use
  [key: string]: unknown
}

export interface UserProfileEntry {
  goal_weight_kg: number | null
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
  const { result: profileResult } = useOne<UserProfileEntry>({
    resource: 'user-profile',
    id: '1',
  })

  const weightLog = (weightLogResult.data as WeightLogEntry[] | undefined) ?? []
  const profileDefault =
    (profileResult as UserProfileEntry | undefined)?.goal_weight_kg ?? HARD_FALLBACK_KG

  return (date: string) => bodyWeight(date, { weightLog, profileDefault })
}
