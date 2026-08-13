import type { MatchEvent, Slot } from '../../../shared/protocol'
import { OTHER } from '../../../shared/protocol'
import { mulberry32, shuffle } from '../../lib/random'
import type { BaseGameState, GameCtx } from '../types'

export const EV_FLIP = 'flip'
export const EV_BANK = 'bank'

export const TILES = 16
export const BOMBS = 3
export const TARGET = 30

/** A bomb tile. Anything else is its face value in points. */
export const BOMB = 0

export type NerveState = BaseGameState & {
  turn: Slot
  /** Increments on every turn change; also seeds that turn's grid. */
  turnIndex: number
  /** Indices revealed during the current turn. */
  revealed: number[]
  /** Points collected this turn but not yet banked. */
  pot: number
  /** True for the beat right after a bomb, so the view can react. */
  busted: boolean
}

/**
 * A fresh grid every turn, derived from the shared seed and the turn number.
 *
 * Reshuffling matters: if the grid persisted, the second player would already
 * know where the bombs were and the whole bet would evaporate.
 */
export function gridFor(seed: number, turnIndex: number): number[] {
  const rand = mulberry32(seed + turnIndex * 2_654_435_761)
  const values: number[] = []
  for (let i = 0; i < BOMBS; i++) values.push(BOMB)
  // Weighted low: big tiles should feel like a find, not the default.
  const faces = [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6]
  for (let i = 0; values.length < TILES; i++) values.push(faces[i % faces.length])
  return shuffle(values, rand)
}

export function init(): NerveState {
  return {
    phase: 'playing',
    scores: { host: 0, guest: 0 },
    winner: null,
    turn: 'host',
    turnIndex: 0,
    revealed: [],
    pot: 0,
    busted: false,
  }
}

/** Chance the next flip is a bomb, for the view's risk readout. */
export function bombOdds(state: NerveState): number {
  const left = TILES - state.revealed.length
  return left > 0 ? BOMBS / left : 0
}

function passTurn(state: NerveState, from: Slot, busted: boolean): NerveState {
  return {
    ...state,
    turn: OTHER[from],
    turnIndex: state.turnIndex + 1,
    revealed: [],
    pot: 0,
    busted,
  }
}

export function reduce(state: NerveState, event: MatchEvent, ctx: GameCtx): NerveState {
  if (state.phase === 'over') return state
  if (event.from === 'system' || event.from !== state.turn) return state

  if (event.type === EV_BANK) {
    const banked = state.scores[event.from] + state.pot
    const scores = { ...state.scores, [event.from]: banked }
    if (banked >= TARGET) {
      return { ...state, scores, pot: 0, phase: 'over', winner: event.from, busted: false }
    }
    return passTurn({ ...state, scores }, event.from, false)
  }

  if (event.type !== EV_FLIP) return state

  const index = Number((event.data as { i?: number } | undefined)?.i)
  if (!Number.isInteger(index) || index < 0 || index >= TILES) return state
  if (state.revealed.includes(index)) return state

  const value = gridFor(ctx.seed, state.turnIndex)[index]
  const revealed = [...state.revealed, index]

  // The bomb takes everything not already banked, and the turn with it.
  if (value === BOMB) return passTurn({ ...state, revealed }, event.from, true)

  return { ...state, revealed, pot: state.pot + value, busted: false }
}

export function replay(events: MatchEvent[], ctx: GameCtx): NerveState {
  return events.reduce((acc, ev) => reduce(acc, ev, ctx), init())
}
