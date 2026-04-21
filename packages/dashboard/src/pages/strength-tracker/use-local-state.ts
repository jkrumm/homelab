import { useCallback, useState } from 'react'

export function useLocalState<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue
    } catch {
      return defaultValue
    }
  })

  const set = useCallback(
    (value: T) => {
      setState(value)
      localStorage.setItem(key, JSON.stringify(value))
    },
    [key],
  )

  return [state, set]
}

const ST_KEYS = [
  'st-date-preset',
  'st-custom-range',
  'st-exercises',
  'st-view',
  'st-record-filter',
  'st-demo-data',
  'strength-tracker-form',
]

export function resetConfig() {
  for (const key of ST_KEYS) localStorage.removeItem(key)
  window.location.reload()
}
