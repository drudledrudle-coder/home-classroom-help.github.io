import type { MatchEvent, Slot } from '../../../shared/protocol'
import { OTHER } from '../../../shared/protocol'
import type { BaseGameState, GameCtx } from '../types'

export const EV_SHOT = 'shot'
export const EV_RESULT = 'result'

export const GRID = 6
export const SHIPS = [3, 2, 2] as const
export const HITS_TO_WIN = SHIPS.reduce((a, b) => a + b, 0)

export type Mark = { i: number; hit: boolean }

export type SalvoState = BaseGameState & {
  turn: Slot
  /** Shots fired *by* each side, with the answer the defender gave. */
  shots: Record<Slot, Mark[]>
  /** A shot awaiting its defender's answer. */
  pending: { by: Slot; i: number } | null
}

export function init(): SalvoState {
  return {
    phase: 'playing',
    scores: { host: 0, guest: 0 },
    winner: null,
    turn: 'host',
    shots: { host: [], guest: [] },
    pending: null,
  }
}

/** Whose client owes an answer right now, if anyone's. */
export function defenderOf(state: SalvoState): Slot | null {
  return state.pending ? OTHER[state.pending.by] : null
}

export function alreadyShot(state: SalvoState, by: Slot, i: number): boolean {
  return state.shots[by].some((s) => s.i === i)
}

/**
 * The reducer never sees a fleet. Only the defender's client knows where its
 * ships are; it answers each shot with a plain hit or miss, and that answer is
 * what both sides record. That is what keeps ship positions out of the shared
 * event log, where the opponent could otherwise simply read them.
 */
export function reduce(state: SalvoState, event: MatchEvent, _ctx: GameCtx): SalvoState {
  if (state.phase === 'over' || event.from === 'system') return state

  if (event.type === EV_SHOT) {
    if (state.pending || event.from !== state.turn) return state
    const i = Number((event.data as { i?: number } | undefined)?.i)
    if (!Number.isInteger(i) || i < 0 || i >= GRID * GRID) return state
    if (alreadyShot(state, event.from, i)) return state
    return { ...state, pending: { by: event.from, i } }
  }

  if (event.type !== EV_RESULT) return state
  // Only the side being shot at may answer, and only for the live shot.
  if (!state.pending || event.from !== OTHER[state.pending.by]) return state

  const data = event.data as { i?: number; hit?: boolean } | undefined
  if (Number(data?.i) !== state.pending.i) return state

  const by = state.pending.by
  const hit = !!data?.hit
  const shots = { ...state.shots, [by]: [...state.shots[by], { i: state.pending.i, hit }] }
  const scores = { ...state.scores, [by]: shots[by].filter((s) => s.hit).length }

  if (scores[by] >= HITS_TO_WIN) {
    return { ...state, shots, scores, pending: null, phase: 'over', winner: by }
  }

  // A hit buys another shot, which is what makes a good streak feel like one.
  return { ...state, shots, scores, pending: null, turn: hit ? by : OTHER[by] }
}

export function replay(events: MatchEvent[], ctx: GameCtx): SalvoState {
  return events.reduce((acc, ev) => reduce(acc, ev, ctx), init())
}

/* -------------------------------------------------------------------------- */
/* Fleets — local only, never transmitted                                      */
/* -------------------------------------------------------------------------- */

export type Fleet = number[]

/** Random legal placement of all three ships. */
export function makeFleet(rand: () => number = Math.random): Fleet {
  for (let attempt = 0; attempt < 200; attempt++) {
    const taken = new Set<number>()
    let ok = true

    for (const size of SHIPS) {
      let placed = false
      for (let tries = 0; tries < 60 && !placed; tries++) {
        const horizontal = rand() < 0.5
        const span = horizontal ? GRID - size + 1 : GRID
        const x = Math.floor(rand() * span)
        const y = Math.floor(rand() * (horizontal ? GRID : GRID - size + 1))

        const cells: number[] = []
        for (let k = 0; k < size; k++) {
          cells.push(horizontal ? y * GRID + x + k : (y + k) * GRID + x)
        }
        if (cells.some((c) => taken.has(c))) continue
        cells.forEach((c) => taken.add(c))
        placed = true
      }
      if (!placed) {
        ok = false
        break
      }
    }

    if (ok && taken.size === HITS_TO_WIN) return [...taken].sort((a, b) => a - b)
  }
  // Fallback that is always legal, so a run of bad luck cannot hang the game.
  return [0, 1, 2, GRID, GRID + 1, 2 * GRID, 2 * GRID + 1]
}

/**
 * The fleet is cached per room and per match in sessionStorage rather than
 * regenerated. A refresh mid-game must return the *same* fleet, or the hits
 * already reported would stop matching the ships.
 */
export function fleetFor(code: string, epoch: number, startedAt: number): Fleet {
  const key = `arcade.fleet.${code}.${epoch}.${startedAt}`
  try {
    const stored = sessionStorage.getItem(key)
    if (stored) {
      const parsed = JSON.parse(stored) as unknown
      if (Array.isArray(parsed) && parsed.length === HITS_TO_WIN) return parsed as Fleet
    }
    const fresh = makeFleet()
    sessionStorage.setItem(key, JSON.stringify(fresh))
    return fresh
  } catch {
    return makeFleet()
  }
}
