import type { SoloId, SoloMeta } from './types'

/**
 * Personal bests, kept in localStorage rather than sessionStorage: a high score
 * you lose when you close the tab is not a high score.
 */
const KEY = (id: SoloId) => `arcade.best.${id}`

export function readBest(id: SoloId): number | null {
  try {
    const raw = localStorage.getItem(KEY(id))
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/** Stores the score if it beats the record. Returns true when it did. */
export function submitScore(id: SoloId, score: number, direction: SoloMeta['direction']): boolean {
  const previous = readBest(id)
  const better = previous === null || (direction === 'high' ? score > previous : score < previous)
  if (!better) return false

  try {
    localStorage.setItem(KEY(id), String(score))
  } catch {
    // Storage disabled. The run still counts on screen; it just will not persist.
  }
  return true
}
