import type { MouseEventHandler } from 'react'

/** Transparent <rect> that captures mouse events for tooltip + crosshair sync. */
export function HoverOverlay({
  width,
  height,
  onMove,
  onLeave,
}: {
  width: number
  height: number
  onMove: MouseEventHandler<SVGRectElement>
  onLeave: MouseEventHandler<SVGRectElement>
}) {
  return (
    <rect
      width={width}
      height={height}
      fill="transparent"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    />
  )
}
