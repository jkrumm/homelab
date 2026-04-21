import { createContext } from 'react'
import type { HoverCtx } from './types'

export const HoverContext = createContext<HoverCtx>({
  date: null,
  source: null,
  setHover: () => {},
})
