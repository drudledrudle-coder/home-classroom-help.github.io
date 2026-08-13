import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'arcade.theme'
/** Must outlast the CSS transition in index.css. */
const CROSSFADE_MS = 460

type ThemeApi = {
  theme: Theme
  /** True once the player has overridden the OS preference this session. */
  manual: boolean
  toggle: () => void
}

const Ctx = createContext<ThemeApi | null>(null)

function currentAttr(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The inline script in index.html has already set the attribute before first
  // paint, so we adopt it rather than recomputing and risking a flash.
  const [theme, setTheme] = useState<Theme>(currentAttr)
  const [manual, setManual] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) !== null
    } catch {
      return false
    }
  })

  const apply = useCallback((next: Theme) => {
    const root = document.documentElement
    // Palette transitions are opt-in and short-lived: leaving them on globally
    // would fight every spring animation in the app.
    root.classList.add('theme-transition')
    root.dataset.theme = next
    window.setTimeout(() => root.classList.remove('theme-transition'), CROSSFADE_MS)
    setTheme(next)
  }, [])

  const toggle = useCallback(() => {
    const next = currentAttr() === 'dark' ? 'light' : 'dark'
    setManual(true)
    try {
      sessionStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage disabled; the choice still holds for this page */
    }
    apply(next)
  }, [apply])

  // Keep following the OS until the player takes manual control.
  useEffect(() => {
    if (manual) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [manual, apply])

  const value = useMemo(() => ({ theme, manual, toggle }), [theme, manual, toggle])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
