const KEY = 'arcade.playerId'

/**
 * Identity lives in sessionStorage, which gives us exactly the semantics we
 * want for free:
 *  - a refresh keeps the same id, so the player reclaims their seat mid-game
 *  - a second tab gets a *different* id, so you can play yourself while testing
 *  - nothing survives the browser closing, so there is no account to manage
 */
export function playerId(): string {
  try {
    const existing = sessionStorage.getItem(KEY)
    if (existing) return existing
    const fresh = mintId()
    sessionStorage.setItem(KEY, fresh)
    return fresh
  } catch {
    // Private browsing with storage disabled: fall back to a per-load id.
    return mintId()
  }
}

function mintId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `p-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

let counter = 0
/** Client-side id used to retire an optimistic event once the server echoes it. */
export function draftId(): string {
  return `d${(counter += 1)}-${Math.random().toString(36).slice(2, 8)}`
}
