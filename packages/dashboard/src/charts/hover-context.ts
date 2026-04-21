import { createContext } from 'react'

export type HoverCtx = {
  date: string | null
  source: string | null
  setHover: (date: string | null, source: string | null) => void
}

/**
 * Shared-cursor context — charts write the hovered date + their own chartId;
 * other charts read and show a ghost crosshair + dot on the same date.
 */
export const HoverContext = createContext<HoverCtx>({
  date: null,
  source: null,
  setHover: () => {},
})
