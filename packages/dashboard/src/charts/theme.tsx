import { useMemo } from 'react'
import { useTheme } from '../providers/theme'
import { VX } from './tokens'

/** Resolve theme-dependent VX colors — re-renders on dark/light toggle via ThemeContext. */
export function useVxTheme() {
  const { isDark } = useTheme()
  return useMemo(
    () => ({
      line: isDark ? VX.lineDark : VX.lineLight,
      line2: isDark ? VX.line2Dark : VX.line2Light,
      axis: isDark ? VX.axisDark : VX.axisLight,
      axisStroke: isDark ? VX.axisStrokeDark : VX.axisStrokeLight,
      tooltipBg: isDark ? VX.tooltipBgDark : VX.tooltipBgLight,
      tooltipText: isDark ? VX.tooltipTextDark : VX.tooltipTextLight,
      tooltipMuted: isDark ? VX.tooltipMutedDark : VX.tooltipMutedLight,
      tooltipBorder: isDark ? 'none' : `1px solid ${VX.tooltipBorderLight}`,
      tooltipShadow: isDark ? VX.tooltipShadowDark : VX.tooltipShadowLight,
    }),
    [isDark],
  )
}
