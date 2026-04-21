export interface DailyMetric {
  date: string
  steps: number | null
  distance_m: number | null
  total_kcal: number | null
  active_kcal: number | null
  floors_ascended: number | null
  moderate_intensity_min: number | null
  vigorous_intensity_min: number | null
  resting_hr: number | null
  max_hr: number | null
  min_hr: number | null
  hrv_last_night_avg: number | null
  hrv_last_night_5min_high: number | null
  hrv_weekly_avg: number | null
  hrv_status: string | null
  sleep_score: number | null
  sleep_duration_sec: number | null
  deep_sleep_sec: number | null
  light_sleep_sec: number | null
  rem_sleep_sec: number | null
  awake_sleep_sec: number | null
  avg_sleep_stress: number | null
  avg_sleep_hr: number | null
  avg_sleep_respiration: number | null
  avg_stress: number | null
  max_stress: number | null
  bb_highest: number | null
  bb_lowest: number | null
  bb_charged: number | null
  bb_drained: number | null
  avg_waking_respiration: number | null
  avg_spo2: number | null
  lowest_spo2: number | null
  vo2_max: number | null
  completed: number | null
  synced_at: string | null
}

export type DatePreset = '7d' | '30d' | '3m' | '1y' | 'all'

// ── Cross-chart hover sync ──────────────────────────────────────────────

export type HoverCtx = {
  date: string | null
  source: string | null
  setHover: (date: string | null, source: string | null) => void
}
