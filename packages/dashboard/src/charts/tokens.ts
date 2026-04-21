/**
 * Visx chart tokens — single source of truth for colors, sizing and theme-dependent values.
 *
 * Never reference raw hex colors in chart files. Always go through VX (theme-agnostic
 * semantic palette + per-metric series colors) or useVxTheme() (theme-resolved neutrals
 * like line/axis/tooltip).
 */

export const VX = {
  // Primary line — per-theme variants
  lineDark: '#c9d1d9',
  lineLight: '#57606a',
  lineWidth: 2.5,

  // Secondary line
  line2Dark: '#8b949e',
  line2Light: '#6e7681',
  line2Width: 2,

  // Semantic fills — consistent opacity across all charts
  good: 'rgba(63, 185, 80, 0.18)',
  goodSoft: 'rgba(63, 185, 80, 0.08)',
  bad: 'rgba(248, 81, 73, 0.18)',
  warn: 'rgba(210, 153, 34, 0.08)',
  goodSolid: '#3fb950',
  badSolid: '#f85149',
  warnSolid: '#d29922',

  // Reference/dashed lines for thresholds
  goodRef: 'rgba(63, 185, 80, 0.3)',
  badRef: 'rgba(248, 81, 73, 0.3)',
  warnRef: 'rgba(210, 153, 34, 0.2)',

  // Grid and axes
  grid: 'rgba(128, 128, 128, 0.12)',
  axisDark: 'rgba(180, 180, 180, 0.8)',
  axisLight: 'rgba(80, 80, 80, 0.75)',
  axisStrokeDark: 'rgba(128, 128, 128, 0.18)',
  axisStrokeLight: 'rgba(128, 128, 128, 0.18)',
  axisFont: 11,

  // Hover crosshair + dot
  crosshair: 'rgba(180, 180, 180, 0.5)',
  dotStroke: '#fff',
  dotR: 5,

  // Tooltip — per-theme variants
  tooltipBgDark: 'rgba(0, 0, 0, 0.88)',
  tooltipBgLight: '#ffffff',
  tooltipMutedDark: 'rgba(255, 255, 255, 0.5)',
  tooltipMutedLight: 'rgba(0, 0, 0, 0.45)',
  tooltipTextDark: 'rgba(255, 255, 255, 0.85)',
  tooltipTextLight: 'rgba(0, 0, 0, 0.85)',
  tooltipBorderLight: 'rgba(0, 0, 0, 0.08)',
  tooltipShadowDark: '0 2px 8px rgba(0,0,0,0.3)',
  tooltipShadowLight: '0 2px 8px rgba(0,0,0,0.1)',

  // Legend
  legendText: 'rgba(220, 220, 220, 0.95)',

  // Per-metric series colors — theme-agnostic, used to give each metric a stable identity.
  series: {
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
    vigorousMin: '#e65100',
    calories: '#ffa726',
    spo2: '#2979ff',
    respiration: '#26a69a',
    vo2max: '#ff6f00',
    acwr: '#1677ff',
    acute: '#ffa726',
    chronic: '#ef5350',
    optimalZone: 'rgba(0,200,83,0.1)',
  },

  // Shared sizing
  margin: { top: 12, right: 16, bottom: 30, left: 44 },
  minPxPerTick: 55,
} as const
