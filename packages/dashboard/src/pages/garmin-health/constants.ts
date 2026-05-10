import dayjs from 'dayjs'
import { VX } from '../../charts'
import type { DatePreset } from './types'

/**
 * Hard floor on visible data. Anything before this date is dropped from the
 * page so charts and moving averages start from a known-clean baseline.
 * Earlier history is still fetched (it warms up MAs) but never rendered.
 */
export const VISIBLE_DATE_MIN = '2026-04-15'

/**
 * Most charts hide today until 22:00 local time — daily aggregates (steps,
 * intensity minutes, body battery, stress, ACWR) build up throughout the day,
 * so a partial reading reads as a misleading dip. Fitness Trends (VO2/RHR/HRV)
 * and Sleep Quality lock in overnight, so they keep today.
 */
export const HIDE_TODAY_BEFORE_HOUR = 22

export const DATE_PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
]

export function getDateRange(preset: DatePreset): [string, string] {
  const today = dayjs().format('YYYY-MM-DD')
  switch (preset) {
    case '7d':
      return [dayjs().subtract(7, 'day').format('YYYY-MM-DD'), today]
    case '30d':
      return [dayjs().subtract(30, 'day').format('YYYY-MM-DD'), today]
    case '3m':
      return [dayjs().subtract(3, 'month').format('YYYY-MM-DD'), today]
    case '1y':
      return [dayjs().subtract(1, 'year').format('YYYY-MM-DD'), today]
    case 'all':
      return ['2000-01-01', today]
  }
}

export const METRIC_TOOLTIPS = {
  sleepScore:
    'Overall sleep quality (0-100). Combines duration, stage balance, and overnight recovery. 90+ excellent, 80-89 good, 60-79 fair, <60 poor. Garmin user average is 72.',
  bodyBattery:
    'Energy balance by day. Charged (gained from rest/sleep) above baseline, Drained (spent on activity/stress) below. Net positive = recovery day, net negative = deficit. Persistent deficits (drained > charged for consecutive days) may indicate chronic fatigue or overtraining.',
  hrv: 'Heart Rate Variability (RMSSD in ms). Higher generally indicates better recovery. A sustained 20%+ drop below your baseline for 3+ days may signal overtraining, illness, or chronic stress. Personal trend matters more than absolute values.',
  restingHr:
    'Resting heart rate (bpm). Lower indicates better cardiovascular fitness. Fit adults: 50-65 bpm, endurance athletes: 35-55. A spike of 5-10+ bpm above baseline may signal illness, overtraining, or dehydration.',
  stress:
    'HRV-based autonomic stress (0-100). Gradient shows zone — 0-24 rest, 25-49 low, 50-74 moderate, 75+ high. Overnight stress should hug zero; elevated overnight may indicate sleep apnea or overtraining.',
  steps:
    'Daily step count. 7,000-10,000 steps/day significantly reduces all-cause mortality. Benefit plateaus around 10,000 for adults under 60.',
  sleepStages:
    'Sleep architecture. Deep (13-23% normal): cell repair, growth hormone. REM (20-25%): memory, emotional processing. Consistently low deep or REM may indicate alcohol, stress, or sleep disorders.',
  spo2: 'Blood oxygen during sleep. Normal: 95-100%. Repeated dips below 90% may indicate sleep apnea. Wearable accuracy: +/-2-5% — use for trends, not diagnosis.',
  respiration:
    'Breathing rate. Awake: 12-20 breaths/min, sleeping: 12-16. Consistently >18 during sleep may indicate sleep-disordered breathing. Often rises 2-4 days before other illness symptoms.',
  vo2max:
    'Maximum oxygen uptake (ml/kg/min). Gold standard for cardiorespiratory fitness. Measured from outdoor GPS runs. Trend matters more than absolute number.',
  activityScore:
    'Daily effort in MET-minutes. Walking (baseline steps ×1), Moderate (×1), Vigorous (×1.8). Weekly target 600 MET-min (≈86/day) covers the WHO floor. Sustained days above target = durable cardiorespiratory benefit; consistently below = detraining risk.',
  recoveryScore:
    'Composite: HRV vs baseline (40%), Sleep Score (35%), Resting HR vs baseline (25%). Green >= 70: push hard. Yellow 40-69: normal. Red <40: prioritize recovery.',
  trainingLoad:
    'Acute:Chronic Workload Ratio (ACWR) using EWMA (Hulin et al. 2017). Compares your recent 7-day training load to your 28-day baseline. <0.8 = undertrained (detraining risk), 0.8-1.3 = optimal adaptation zone, 1.3-1.5 = elevated injury risk, >1.5 = danger zone. Daily load estimated from intensity minutes (moderate x1.0 + vigorous x1.8).',
  fitnessTrends:
    'Smoothed 7-day moving averages of Resting HR and HRV. Declining RHR = stronger cardiovascular system (better stroke volume). Rising HRV = improving autonomic recovery capacity. Daily noise is normal — focus on the trend direction over weeks and months.',
  loadBalance:
    'Short-term (7-day EWMA) vs long-term (28-day EWMA) training load. When the short-term line rises sharply above long-term, you are spiking load — injury risk increases. Gradual, steady increases keep both lines close together (optimal). A declining short-term below long-term signals detraining.',
  activities:
    'Recorded workouts per day, stacked by duration. Color = activity type. Walking is excluded (filtered server-side). Garmin under-reports gym load because rest periods between sets keep avg HR low — height shows duration, tooltip surfaces aerobic/anaerobic Training Effect and max HR so the actual stress is visible. ACWR uses Garmin\'s own load number; this chart is a separate signal.',
}

// Activity-type display + color map. typeKey values from get_activities_by_date.
// Anything not in this map falls through to the "other" bucket (muted neutral).
type ActivityTypeMeta = { label: string; color: string }

const ACTIVITY_TYPE_META: Record<string, ActivityTypeMeta> = {
  indoor_cardio: { label: 'Gym', color: VX.series.activity.gym },
  strength_training: { label: 'Gym', color: VX.series.activity.gym },
  cycling: { label: 'Cycling', color: VX.series.activity.cycling },
  road_biking: { label: 'Cycling', color: VX.series.activity.cycling },
  mountain_biking: { label: 'MTB', color: VX.series.activity.cycling },
  indoor_cycling: { label: 'Indoor Bike', color: VX.series.activity.cycling },
  tennis_v2: { label: 'Tennis', color: VX.series.activity.tennis },
  tennis: { label: 'Tennis', color: VX.series.activity.tennis },
  running: { label: 'Running', color: VX.series.activity.running },
  trail_running: { label: 'Trail Run', color: VX.series.activity.running },
  treadmill_running: { label: 'Treadmill', color: VX.series.activity.running },
}

const ACTIVITY_TYPE_OTHER: ActivityTypeMeta = {
  label: 'Other',
  color: VX.series.activity.other,
}

export function activityTypeMeta(typeKey: string): ActivityTypeMeta {
  return ACTIVITY_TYPE_META[typeKey] ?? ACTIVITY_TYPE_OTHER
}

/** Distinct types observed in `activities`, ordered by total duration desc. Used to drive the legend. */
export function activityLegendTypes(
  activities: { type_key: string; duration_sec: number | null }[],
): ActivityTypeMeta[] {
  const totals = new Map<string, number>()
  for (const a of activities) {
    const meta = activityTypeMeta(a.type_key)
    const dur = a.duration_sec ?? 0
    totals.set(meta.label, (totals.get(meta.label) ?? 0) + dur)
  }
  // Resolve label → meta (using first match for that label)
  const seen = new Map<string, ActivityTypeMeta>()
  for (const a of activities) {
    const meta = activityTypeMeta(a.type_key)
    if (!seen.has(meta.label)) seen.set(meta.label, meta)
  }
  return [...seen.values()].sort(
    (a, b) => (totals.get(b.label) ?? 0) - (totals.get(a.label) ?? 0),
  )
}

export function scoreColor(score: number | null): string {
  if (score === null) return '#999'
  if (score >= 90) return '#00c853'
  if (score >= 80) return '#64dd17'
  if (score >= 60) return '#ffd600'
  return '#ff3d00'
}

export function stressColor(stress: number | null): string {
  if (stress === null) return '#999'
  if (stress <= 25) return '#00c853'
  if (stress <= 50) return '#64dd17'
  if (stress <= 75) return '#ffd600'
  return '#ff3d00'
}

export function hrvStatusColor(status: string | null): string {
  if (status === 'BALANCED') return '#00c853'
  if (status === 'UNBALANCED') return '#ffd600'
  if (status === 'LOW') return '#ff3d00'
  return '#999'
}
