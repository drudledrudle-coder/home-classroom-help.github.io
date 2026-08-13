import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * How hard the bot plays. Five stops rather than three: the middle of a
 * three-stop scale ends up carrying every player who is neither a beginner nor
 * an expert, which is most of them.
 */
export type Difficulty = 1 | 2 | 3 | 4 | 5

export const DIFFICULTIES: Difficulty[] = [1, 2, 3, 4, 5]
export const DEFAULT_DIFFICULTY: Difficulty = 3

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  1: 'Gentle',
  2: 'Easy',
  3: 'Even',
  4: 'Sharp',
  5: 'Ruthless',
}

const STORAGE_KEY = 'arcade.difficulty'

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'number' && value >= 1 && value <= 5 && Number.isInteger(value)
}

/**
 * Difficulty as a 0..1 ratio, which is what the bots actually want — every bot
 * expresses itself as "this constant at Gentle, that one at Ruthless" and
 * interpolates between them.
 */
export const ratioOf = (level: Difficulty): number => (level - 1) / 4

/** Interpolate a bot constant between its easiest and hardest values. */
export const scale = (level: Difficulty, easiest: number, hardest: number): number =>
  easiest + (hardest - easiest) * ratioOf(level)

type DifficultyApi = {
  difficulty: Difficulty
  setDifficulty: (level: Difficulty) => void
}

const Ctx = createContext<DifficultyApi | null>(null)

export function DifficultyProvider({ children }: { children: ReactNode }) {
  const [difficulty, setState] = useState<Difficulty>(() => {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY))
      return isDifficulty(stored) ? stored : DEFAULT_DIFFICULTY
    } catch {
      return DEFAULT_DIFFICULTY
    }
  })

  const setDifficulty = useCallback((level: Difficulty) => {
    setState(level)
    try {
      localStorage.setItem(STORAGE_KEY, String(level))
    } catch {
      /* storage disabled; the choice still holds for this page */
    }
  }, [])

  const value = useMemo(() => ({ difficulty, setDifficulty }), [difficulty, setDifficulty])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDifficulty(): DifficultyApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDifficulty must be used inside DifficultyProvider')
  return ctx
}

/**
 * Read the stored level without React. The bot transport is created outside the
 * component tree, so it cannot use the hook.
 */
export function currentDifficulty(): Difficulty {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    return isDifficulty(stored) ? stored : DEFAULT_DIFFICULTY
  } catch {
    return DEFAULT_DIFFICULTY
  }
}
