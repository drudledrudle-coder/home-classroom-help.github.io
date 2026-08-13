import type { MatchEvent, Slot } from '../../../shared/protocol'
import { mulberry32 } from '../../lib/random'
import { EV_TIMEUP } from '../../net/shellState'
import type { BaseGameState, GameCtx } from '../types'

export const EV_CLAIM = 'claim'
export const DURATION_MS = 30_000

/** How long a claimed dot stays on screen so you can see who took it. */
export const CLAIM_FLASH_MS = 420

const SPAWN_EVERY_MS = 430
const LIFE_MIN_MS = 1_350
const LIFE_VAR_MS = 600
const EDGE = 0.09
const MIN_GAP = 0.19

/**
 * Latency grace on the claim window. Wide on purpose: wrongly rejecting a real
 * tap from a player on a slow connection is far worse than tolerating a
 * slightly late one. It exists only to stop a tampered client from claiming
 * every dot at once.
 */
const EARLY_GRACE_MS = 300
const LATE_GRACE_MS = 1_200

export type Dot = {
  id: number
  x: number
  y: number
  /** Milliseconds after match start. */
  at: number
  life: number
}

export type Claim = { by: Slot; at: number }

export type GrabState = BaseGameState & {
  claimed: Record<number, Claim>
}

const cache = new Map<number, Dot[]>()

/**
 * The dot schedule is derived from the shared seed rather than transmitted, so
 * both screens show the same dots in the same places at the same moment with
 * no traffic at all.
 */
export function scheduleFor(seed: number): Dot[] {
  const hit = cache.get(seed)
  if (hit) return hit

  const rand = mulberry32(seed ^ 0x5f3a)
  const dots: Dot[] = []
  let t = 700
  let id = 0

  while (t < DURATION_MS - 500) {
    const life = LIFE_MIN_MS + Math.floor(rand() * LIFE_VAR_MS)

    // Keep simultaneous dots apart so two targets never overlap under a thumb.
    let x = 0
    let y = 0
    for (let attempt = 0; attempt < 12; attempt++) {
      x = EDGE + rand() * (1 - EDGE * 2)
      y = EDGE + rand() * (1 - EDGE * 2)
      const clash = dots.some(
        (d) => d.at + d.life > t && Math.hypot(d.x - x, d.y - y) < MIN_GAP,
      )
      if (!clash) break
    }

    dots.push({ id: id++, x, y, at: t, life })
    t += Math.round(SPAWN_EVERY_MS * (0.75 + rand() * 0.5))
  }

  cache.set(seed, dots)
  return dots
}

export function init(): GrabState {
  return {
    phase: 'playing',
    scores: { host: 0, guest: 0 },
    winner: null,
    claimed: {},
  }
}

function settle(state: GrabState): GrabState {
  const { host, guest } = state.scores
  return {
    ...state,
    phase: 'over',
    winner: host === guest ? 'tie' : host > guest ? 'host' : 'guest',
  }
}

export function reduce(state: GrabState, event: MatchEvent, ctx: GameCtx): GrabState {
  if (state.phase === 'over') return state

  if (event.type === EV_TIMEUP) return settle(state)
  if (event.type !== EV_CLAIM || event.from === 'system') return state

  const id = Number((event.data as { id?: number } | undefined)?.id)
  if (!Number.isInteger(id)) return state
  // Log order decides the race; the loser's claim simply does nothing.
  if (state.claimed[id]) return state

  const dot = scheduleFor(ctx.seed).find((d) => d.id === id)
  if (!dot) return state

  const elapsed = event.at - ctx.startedAt
  if (elapsed < dot.at - EARLY_GRACE_MS) return state
  if (elapsed > dot.at + dot.life + LATE_GRACE_MS) return state

  return {
    ...state,
    claimed: { ...state.claimed, [id]: { by: event.from, at: elapsed } },
    scores: { ...state.scores, [event.from]: state.scores[event.from] + 1 },
  }
}

export function replay(events: MatchEvent[], ctx: GameCtx): GrabState {
  return events.reduce((acc, ev) => reduce(acc, ev, ctx), init())
}
