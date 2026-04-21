import { AxisBottom, AxisLeft, type AxisScale } from '@visx/axis'
import { useVxTheme } from '../theme'
import { VX } from '../tokens'
import { fmtAxisDate } from '../utils/format'

/** Themed left numeric axis — baked-in theme colors + font size. */
export function AxisLeftNumeric({
  scale,
  numTicks = 5,
}: {
  scale: AxisScale
  numTicks?: number
}) {
  const { axis, axisStroke } = useVxTheme()
  return (
    <AxisLeft
      scale={scale}
      numTicks={numTicks}
      tickLabelProps={{ fill: axis, fontSize: VX.axisFont, dx: -4 }}
      stroke={axisStroke}
      tickStroke={axisStroke}
    />
  )
}

/** Themed bottom date axis — baked-in smartTicks + DD.MM formatting. */
export function AxisBottomDate({
  scale,
  top,
  tickValues,
}: {
  scale: AxisScale
  top: number
  tickValues: string[]
}) {
  const { axis, axisStroke } = useVxTheme()
  return (
    <AxisBottom
      top={top}
      scale={scale}
      tickValues={tickValues}
      tickFormat={fmtAxisDate}
      tickLabelProps={{ fill: axis, fontSize: VX.axisFont, textAnchor: 'middle' }}
      stroke={axisStroke}
      tickStroke={axisStroke}
    />
  )
}
