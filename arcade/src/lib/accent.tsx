import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from './theme'

/**
 * The accent is the only colour in the app, so it is the one thing worth
 * letting people change.
 *
 * Each accent ships as a *pair*, not one value: a hue that reads well on the
 * near-black ground is usually too light to sit on warm paper, and the text
 * colour that belongs on top flips with it. Picking these by hand beats
 * deriving them — lime needs black text, azure needs white.
 */

export type AccentId = 'mono' | 'vermillion' | 'amber' | 'lime' | 'teal' | 'azure' | 'magenta'

type Variant = { c: string; ink: string }

export const ACCENTS: Record<AccentId, { label: string; dark: Variant; light: Variant }> = {
  /**
   * Two tone: the accent *is* the ink, inverted per theme. White on black in the
   * dark, black on white in the light, so the app reads as one material with
   * nothing decorative in it — which is the most minimal the palette can get
   * without removing the accent concept entirely.
   *
   * Danger stays red regardless (see `--t-danger`). A monochrome scheme is
   * exactly where a warning most needs to break out of the palette, not least
   * because "you are the imposter" in plain black would be indistinguishable
   * from ordinary text.
   */
  mono: {
    label: 'Mono',
    dark: { c: '#f4f2ed', ink: '#0b0b0c' },
    light: { c: '#17150f', ink: '#ffffff' },
  },
  vermillion: {
    label: 'Vermillion',
    dark: { c: '#ff4a2b', ink: '#0b0b0c' },
    light: { c: '#de3009', ink: '#ffffff' },
  },
  amber: {
    label: 'Amber',
    dark: { c: '#ffb020', ink: '#0b0b0c' },
    light: { c: '#a35c00', ink: '#ffffff' },
  },
  lime: {
    label: 'Lime',
    dark: { c: '#c9f231', ink: '#0b0b0c' },
    light: { c: '#5c7300', ink: '#ffffff' },
  },
  teal: {
    label: 'Teal',
    dark: { c: '#2dd4bf', ink: '#0b0b0c' },
    light: { c: '#0c7a6c', ink: '#ffffff' },
  },
  azure: {
    label: 'Azure',
    dark: { c: '#5c9bff', ink: '#0b0b0c' },
    light: { c: '#1155d6', ink: '#ffffff' },
  },
  magenta: {
    label: 'Magenta',
    dark: { c: '#ff5fa8', ink: '#0b0b0c' },
    light: { c: '#c1006a', ink: '#ffffff' },
  },
}

export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[]
/**
 * Mono by default. A first-time visitor should meet the most restrained version
 * of the app; colour is then something they choose rather than something they
 * have to undo. A stored choice always wins, so this only affects a fresh
 * browser.
 */
export const DEFAULT_ACCENT: AccentId = 'mono'
export const ACCENT_STORAGE_KEY = 'arcade.accent'

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && value in ACCENTS
}

/** Writes the pair for the active theme onto <html>, overriding the stylesheet. */
export function applyAccent(id: AccentId, theme: 'light' | 'dark'): void {
  const variant = ACCENTS[id][theme]
  const root = document.documentElement
  root.style.setProperty('--t-accent', variant.c)
  root.style.setProperty('--t-accent-ink', variant.ink)
}

type AccentApi = {
  accent: AccentId
  setAccent: (id: AccentId) => void
}

const Ctx = createContext<AccentApi | null>(null)

export function AccentProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme()

  const [accent, setAccentState] = useState<AccentId>(() => {
    try {
      const stored = localStorage.getItem(ACCENT_STORAGE_KEY)
      return isAccentId(stored) ? stored : DEFAULT_ACCENT
    } catch {
      return DEFAULT_ACCENT
    }
  })

  // Re-applies on theme change too, since each accent has a per-theme variant.
  useEffect(() => {
    applyAccent(accent, theme)
  }, [accent, theme])

  const setAccent = useCallback((id: AccentId) => {
    setAccentState(id)
    try {
      // localStorage, not session: a colour choice is a preference people
      // expect to still be there tomorrow, unlike the light/dark toggle.
      localStorage.setItem(ACCENT_STORAGE_KEY, id)
    } catch {
      /* storage disabled; the choice still holds for this page */
    }
  }, [])

  const value = useMemo(() => ({ accent, setAccent }), [accent, setAccent])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAccent(): AccentApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAccent must be used inside AccentProvider')
  return ctx
}
