import type { SoloId } from './types'

/**
 * Saved mid-run state, so backing out of a game and returning picks up where it
 * left off.
 *
 * Each game owns the *shape* of what it saves — a board, a tower, a snake — and
 * this only handles storing it, versioning it and throwing it away when it goes
 * stale. Trying to define one universal "game state" here would either be an
 * `any` in a coat or force every game into a shape that suits none of them.
 *
 * sessionStorage, not localStorage: a half-finished run is a property of *this*
 * visit. Coming back tomorrow to a two-day-old board you have forgotten the plan
 * for is worse than starting fresh, and the score you actually care about is
 * already saved separately.
 */

const KEY = (id: SoloId) => `arcade.resume.${id}`

/**
 * Bumped when a saved shape changes incompatibly. An old entry is then dropped
 * rather than fed to a reducer that no longer understands it — a crash on
 * re-entry is far worse than losing one unfinished run.
 */
const VERSION = 1

type Envelope<T> = { v: number; at: number; state: T }

/** Stale after this long unused, even inside one session. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000

export function saveResume<T>(id: SoloId, state: T): void {
  try {
    const envelope: Envelope<T> = { v: VERSION, at: Date.now(), state }
    sessionStorage.setItem(KEY(id), JSON.stringify(envelope))
  } catch {
    // Storage disabled, or the state does not serialise. Either way the run
    // simply will not resume; it must never break the run in progress.
  }
}

export function loadResume<T>(id: SoloId): T | null {
  try {
    const raw = sessionStorage.getItem(KEY(id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Envelope<T>
    if (!parsed || parsed.v !== VERSION) return null
    if (Date.now() - parsed.at > MAX_AGE_MS) return null
    return parsed.state
  } catch {
    return null
  }
}

export function clearResume(id: SoloId): void {
  try {
    sessionStorage.removeItem(KEY(id))
  } catch {
    /* nothing to do */
  }
}

export function hasResume(id: SoloId): boolean {
  return loadResume(id) !== null
}
