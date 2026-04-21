import { createContext } from 'react'

export type HoverCtx = {
  date: string | null
  source: string | null
  setHover: (date: string | null, source: string | null) => void
}

/**
 * Sentinel so `useHoverSync` can detect a missing Provider and warn in dev.
 * Exported only for that identity check — do NOT call directly.
 */
export const DEFAULT_NO_OP_SET_HOVER: HoverCtx['setHover'] = () => {}

/**
 * Shared-cursor context — charts write the hovered date + their own chartId;
 * other charts read and show a ghost crosshair + dot on the same date.
 */
export const HoverContext = createContext<HoverCtx>({
  date: null,
  source: null,
  setHover: DEFAULT_NO_OP_SET_HOVER,
})
