import dayjs from 'dayjs'
import type { DatePreset } from './types'

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

export const COLORS = {
  // Sleep stages
  deep: '#1e3a5f',
  rem: '#7c4dff',
  light: '#90caf9',
  awake: '#757575',

  // Metrics
  sleepScore: '#7c4dff',
  sleepDuration: '#5c6bc0',
  bodyBatteryHigh: '#00bfa5',
  bodyBatteryLow: '#80cbc4',
  charged: '#00c853',
  drained: '#ff6d00',
  hrv: '#aa00ff',
  hrvWeekly: '#ce93d8',
  restingHr: '#ff5252',
  stress: '#ff6d00',
  sleepStress: '#5c6bc0',
  steps: '#4caf50',
  intensityMin: '#2e7d32',
  calories: '#ffa726',
  spo2: '#2979ff',
  respiration: '#26a69a',
  vo2max: '#ff6f00',
  acwr: '#1677ff',
  acute: '#ffa726',
  chronic: '#ef5350',
  optimalZone: 'rgba(0,200,83,0.1)',
}

export const METRIC_TOOLTIPS = {
  sleepScore:
    'Overall sleep quality (0-100). Combines duration, stage balance, and overnight recovery. 90+ excellent, 80-89 good, 60-79 fair, <60 poor. Garmin user average is 72.',
  bodyBattery:
    "Garmin's energy reserve (5-100). Charged by rest and sleep, drained by activity and stress. Consistently waking below 50 despite 7+ hours sleep may indicate chronic fatigue or overtraining.",
  hrv: 'Heart Rate Variability (RMSSD in ms). Higher generally indicates better recovery. A sustained 20%+ drop below your baseline for 3+ days may signal overtraining, illness, or chronic stress. Personal trend matters more than absolute values.',
  restingHr:
    'Resting heart rate (bpm). Lower indicates better cardiovascular fitness. Fit adults: 50-65 bpm, endurance athletes: 35-55. A spike of 5-10+ bpm above baseline may signal illness, overtraining, or dehydration.',
  stress:
    'HRV-based autonomic stress (0-100). 0-24 rest, 25-49 low, 50-74 moderate, 75-100 high. Elevated stress during sleep (should be near zero) may indicate sleep apnea or overtraining.',
  steps:
    'Daily step count. 7,000-10,000 steps/day significantly reduces all-cause mortality. Benefit plateaus around 10,000 for adults under 60.',
  sleepStages:
    'Sleep architecture. Deep (13-23% normal): cell repair, growth hormone. REM (20-25%): memory, emotional processing. Consistently low deep or REM may indicate alcohol, stress, or sleep disorders.',
  spo2: 'Blood oxygen during sleep. Normal: 95-100%. Repeated dips below 90% may indicate sleep apnea. Wearable accuracy: +/-2-5% — use for trends, not diagnosis.',
  respiration:
    'Breathing rate. Awake: 12-20 breaths/min, sleeping: 12-16. Consistently >18 during sleep may indicate sleep-disordered breathing. Often rises 2-4 days before other illness symptoms.',
  vo2max:
    'Maximum oxygen uptake (ml/kg/min). Gold standard for cardiorespiratory fitness. Measured from outdoor GPS runs. Trend matters more than absolute number.',
  intensityMinutes:
    'WHO: 150-300 min/week moderate OR 75-150 vigorous. Vigorous counts double. The single strongest modifiable factor for longevity.',
  recoveryScore:
    'Composite: HRV vs baseline (40%), Sleep Score (35%), Resting HR vs baseline (25%). Green >= 70: push hard. Yellow 40-69: normal. Red <40: prioritize recovery.',
  trainingLoad:
    'Acute:Chronic Workload Ratio (ACWR) using EWMA (Hulin et al. 2017). Compares your recent 7-day training load to your 28-day baseline. <0.8 = undertrained (detraining risk), 0.8-1.3 = optimal adaptation zone, 1.3-1.5 = elevated injury risk, >1.5 = danger zone. Daily load estimated from intensity minutes (moderate x1.0 + vigorous x1.8).',
  fitnessTrends:
    'Smoothed 7-day moving averages of Resting HR and HRV. Declining RHR = stronger cardiovascular system (better stroke volume). Rising HRV = improving autonomic recovery capacity. Daily noise is normal — focus on the trend direction over weeks and months.',
  loadBalance:
    'Short-term (7-day EWMA) vs long-term (28-day EWMA) training load. When the short-term line rises sharply above long-term, you are spiking load — injury risk increases. Gradual, steady increases keep both lines close together (optimal). A declining short-term below long-term signals detraining.',
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
