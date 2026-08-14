import type { SoloId, SoloMeta } from './types'

/**
 * Scores, kept in localStorage rather than sessionStorage: a high score you lose
 * when you close the tab is not a high score.
 *
 * A *log of runs* rather than three stored records. Three records would need
 * their own expiry logic — "is this daily best still from today?" — and would
 * quietly rot when the day rolled over while the tab was open. Deriving each
 * window from the runs makes that impossible by construction, and it is also
 * the shape a leaderboard wants when one arrives: every entry already carries
 * its timestamp.
 */

export type Run = { s: number; t: number }
export type Window = 'today' | 'week' | 'all'

const KEY = (id: SoloId) => `arcade.runs.${id}`
/** Old single-value key, still read once so existing bests are not lost. */
const LEGACY_KEY = (id: SoloId) => `arcade.best.${id}`

/**
 * Enough to cover any plausible session history without letting one game's log
 * grow unbounded. Only the best of each window is ever shown, so old middling
 * runs carry no information once they are past.
 */
const MAX_RUNS = 300

const DAY_MS = 24 * 60 * 60 * 1000

/** Local midnight, so "today" means the player's today, not UTC's. */
function startOfToday(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * A rolling seven days rather than "since Monday". A week that resets overnight
 * erases a good run the player made yesterday, which reads as the app losing
 * their score rather than as a new week starting.
 */
function startOfWeek(now: number): number {
  return now - 7 * DAY_MS
}

export function readRuns(id: SoloId): Run[] {
  try {
    const raw = localStorage.getItem(KEY(id))
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (r): r is Run =>
            !!r &&
            typeof r === 'object' &&
            Number.isFinite((r as Run).s) &&
            Number.isFinite((r as Run).t),
        )
      }
      return []
    }

    // Migrate a pre-existing best. Its date is unknown, so it is backdated far
    // enough to count only towards all-time — claiming it as today's would be a
    // guess, and the wrong one most of the time.
    const legacy = Number(localStorage.getItem(LEGACY_KEY(id)))
    if (Number.isFinite(legacy) && localStorage.getItem(LEGACY_KEY(id)) !== null) {
      return [{ s: legacy, t: 0 }]
    }
    return []
  } catch {
    return []
  }
}

const since = (window: Window, now: number): number =>
  window === 'today' ? startOfToday(now) : window === 'week' ? startOfWeek(now) : -Infinity

/** Best score inside a window, or null if nothing was played in it. */
export function bestIn(
  id: SoloId,
  window: Window,
  direction: SoloMeta['direction'],
  now: number = Date.now(),
): number | null {
  const cutoff = since(window, now)
  const scores = readRuns(id)
    .filter((r) => r.t >= cutoff)
    .map((r) => r.s)
  if (!scores.length) return null
  return direction === 'high' ? Math.max(...scores) : Math.min(...scores)
}

/** All-time best. Kept as its own name because the home screen only wants this. */
export function readBest(id: SoloId, direction: SoloMeta['direction'] = 'high'): number | null {
  return bestIn(id, 'all', direction)
}

/**
 * Records a run. Returns which windows it became the best of, so the result
 * card can say "new best today" rather than only celebrating all-time records —
 * beating your own week is the reward that keeps someone playing on day three.
 */
export function submitScore(
  id: SoloId,
  score: number,
  direction: SoloMeta['direction'],
  now: number = Date.now(),
): Window[] {
  const beaten: Window[] = []
  for (const w of ['today', 'week', 'all'] as Window[]) {
    const prev = bestIn(id, w, direction, now)
    if (prev === null || (direction === 'high' ? score > prev : score < prev)) beaten.push(w)
  }

  try {
    const runs = [...readRuns(id), { s: score, t: now }].slice(-MAX_RUNS)
    localStorage.setItem(KEY(id), JSON.stringify(runs))
    // The legacy value has been folded into the log; leaving it would make it
    // reappear on any future read that finds an empty log.
    localStorage.removeItem(LEGACY_KEY(id))
  } catch {
    // Storage disabled. The run still counts on screen; it just will not persist.
  }

  return beaten
}
