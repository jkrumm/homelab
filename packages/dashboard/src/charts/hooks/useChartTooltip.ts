import { useCallback, useRef, useState } from 'react'

export type TooltipState<T> = { data: T; x: number; y: number } | null

export function useChartTooltip<T>() {
  const [tip, setTip] = useState<TooltipState<T>>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const lastDateRef = useRef<string | null>(null)

  const show = useCallback((data: T, event: React.MouseEvent) => {
    setTip({ data, x: event.clientX + 12, y: event.clientY - 12 })
    // Move tooltip via DOM directly to avoid re-renders on every pixel
    if (tooltipRef.current) {
      tooltipRef.current.style.left = `${event.clientX + 12}px`
      tooltipRef.current.style.top = `${event.clientY - 12}px`
    }
  }, [])

  const hide = useCallback(() => {
    setTip(null)
    lastDateRef.current = null
  }, [])

  return { tip, show, hide, tooltipRef, lastDateRef }
}
