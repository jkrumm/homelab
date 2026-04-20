import type { DailyMetric } from './types'

/** Extract non-null numeric values for a field */
function validValues(data: DailyMetric[], field: keyof DailyMetric): number[] {
  return data.map((d) => d[field]).filter((v): v is number => typeof v === 'number')
}

/** Average of a numeric field, null if no data */
export function fieldAvg(data: DailyMetric[], field: keyof DailyMetric): number | null {
  const vals = validValues(data, field)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** Most recent non-null numeric value */
export function latestValue(data: DailyMetric[], field: keyof DailyMetric): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i]![field]
    if (typeof v === 'number') return v
  }
  return null
}

/** Most recent non-null string value */
export function latestStringValue(data: DailyMetric[], field: keyof DailyMetric): string | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i]![field]
    if (typeof v === 'string') return v
  }
  return null
}

/** Delta (%) comparing second half of period to first half */
export function periodDelta(
  data: DailyMetric[],
  field: keyof DailyMetric,
  invertBetter?: boolean,
): number | null {
  if (data.length < 4) return null
  const mid = Math.floor(data.length / 2)
  const firstAvg = fieldAvg(data.slice(0, mid), field)
  const secondAvg = fieldAvg(data.slice(mid), field)
  if (firstAvg === null || secondAvg === null || firstAvg === 0) return null
  const raw = ((secondAvg - firstAvg) / Math.abs(firstAvg)) * 100
  return invertBetter ? -raw : raw
}

/** Format seconds to "Xh Ym" */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '\u2014'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

/** Seconds to hours (1 decimal) */
export function secToHours(seconds: number | null): number | null {
  if (seconds === null) return null
  return Math.round((seconds / 3600) * 10) / 10
}

/** Compute recovery score (0-100) from HRV, sleep score, and RHR */
export function computeRecoveryScore(
  metric: DailyMetric,
  avgHrv: number | null,
  avgRhr: number | null,
  minRhr: number | null,
  maxRhr: number | null,
): number | null {
  const { hrv_last_night_avg: hrv, sleep_score: sleep, resting_hr: rhr } = metric
  if (hrv === null && sleep === null && rhr === null) return null

  let score = 0
  let weight = 0

  if (hrv !== null && avgHrv !== null && avgHrv > 0) {
    score += Math.min(100, (hrv / avgHrv) * 100) * 0.4
    weight += 0.4
  }

  if (sleep !== null) {
    score += sleep * 0.35
    weight += 0.35
  }

  if (rhr !== null && minRhr !== null && maxRhr !== null && maxRhr > minRhr) {
    const rhrComp = (1 - (rhr - minRhr) / (maxRhr - minRhr)) * 100
    score += Math.max(0, Math.min(100, rhrComp)) * 0.25
    weight += 0.25
  }

  return weight === 0 ? null : Math.round(score / weight)
}

/** Build sleep stage chart data (seconds -> hours) */
export function buildSleepChartData(data: DailyMetric[]) {
  return data
    .filter((d) => d.sleep_duration_sec !== null)
    .map((d) => ({
      date: d.date,
      deep: secToHours(d.deep_sleep_sec),
      rem: secToHours(d.rem_sleep_sec),
      light: secToHours(d.light_sleep_sec),
      awake: secToHours(d.awake_sleep_sec),
      sleepScore: d.sleep_score,
    }))
}

/** Build body battery chart data with range for area band */
export function buildBodyBatteryData(data: DailyMetric[]) {
  return data
    .filter((d) => d.bb_highest !== null || d.bb_lowest !== null)
    .map((d) => ({
      date: d.date,
      high: d.bb_highest,
      low: d.bb_lowest,
      range: d.bb_highest !== null && d.bb_lowest !== null ? d.bb_highest - d.bb_lowest : null,
      charged: d.bb_charged,
      drained: d.bb_drained,
    }))
}

/** Build heart rate + HRV chart data */
export function buildHeartChartData(data: DailyMetric[]) {
  return data
    .filter((d) => d.resting_hr !== null || d.hrv_last_night_avg !== null)
    .map((d) => ({
      date: d.date,
      restingHr: d.resting_hr,
      hrv: d.hrv_last_night_avg,
      hrvWeekly: d.hrv_weekly_avg,
    }))
}

/** Build stress chart data */
export function buildStressData(data: DailyMetric[]) {
  return data
    .filter((d) => d.avg_stress !== null)
    .map((d) => ({
      date: d.date,
      avgStress: d.avg_stress,
      maxStress: d.max_stress,
      sleepStress: d.avg_sleep_stress,
    }))
}

/** Build activity chart data */
export function buildActivityData(data: DailyMetric[]) {
  return data
    .filter((d) => d.steps !== null)
    .map((d) => ({
      date: d.date,
      steps: d.steps,
      intensityMin:
        d.moderate_intensity_min !== null || d.vigorous_intensity_min !== null
          ? (d.moderate_intensity_min ?? 0) + (d.vigorous_intensity_min ?? 0)
          : null,
      calories: d.total_kcal,
      activeCal: d.active_kcal,
    }))
}

/** Format date for chart X axis */
export function formatXDate(date: string): string {
  const d = new Date(date)
  return `${d.getDate()}/${d.getMonth() + 1}`
}
