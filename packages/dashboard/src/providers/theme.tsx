import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ThemeCtx = {
  isDark: boolean
  toggle: () => void
}

const ThemeContext = createContext<ThemeCtx>({ isDark: true, toggle: () => {} })

function getInitialDark(): boolean {
  const stored = localStorage.getItem('theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(getInitialDark)

  const toggle = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev
      localStorage.setItem('theme', next ? 'dark' : 'light')
      return next
    })
  }, [])

  const value = useMemo(() => ({ isDark, toggle }), [isDark, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext)
}
