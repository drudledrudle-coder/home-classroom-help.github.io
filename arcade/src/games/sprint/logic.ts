import type { MatchEvent, Slot } from '../../../shared/protocol'
import { EV_TIMEUP } from '../../net/shellState'
import type { BaseGameState, GameCtx } from '../types'
import { MIN_WORD, isWord, rackFor, scoreOf, spellable } from './dictionary'

export const EV_WORD = 'word'
export const DURATION_MS = 60_000

export type SprintState = BaseGameState & {
  letters: string[]
  found: Record<Slot, string[]>
}

export type Rejection = 'short' | 'letters' | 'unknown' | 'duplicate' | null

export function init(ctx: GameCtx): SprintState {
  return {
    phase: 'playing',
    scores: { host: 0, guest: 0 },
    winner: null,
    letters: rackFor(ctx.seed),
    found: { host: [], guest: [] },
  }
}

/**
 * Why a word is not acceptable, or null if it is. Shared by the reducer and the
 * view so the message a player sees is decided by the same code that scores it.
 */
export function checkWord(word: string, letters: string[], already: string[]): Rejection {
  if (word.length < MIN_WORD) return 'short'
  if (!spellable(word, letters)) return 'letters'
  if (already.includes(word)) return 'duplicate'
  if (!isWord(word)) return 'unknown'
  return null
}

function settle(state: SprintState): SprintState {
  const { host, guest } = state.scores
  return {
    ...state,
    phase: 'over',
    winner: host === guest ? 'tie' : host > guest ? 'host' : 'guest',
  }
}

export function reduce(state: SprintState, event: MatchEvent, _ctx: GameCtx): SprintState {
  if (state.phase === 'over') return state

  if (event.type === EV_TIMEUP) return settle(state)
  if (event.type !== EV_WORD || event.from === 'system') return state

  const raw = (event.data as { w?: unknown } | undefined)?.w
  if (typeof raw !== 'string') return state
  const word = raw.toLowerCase().trim()

  if (checkWord(word, state.letters, state.found[event.from])) return state

  return {
    ...state,
    found: { ...state.found, [event.from]: [...state.found[event.from], word] },
    scores: { ...state.scores, [event.from]: state.scores[event.from] + scoreOf(word) },
  }
}

export function replay(events: MatchEvent[], ctx: GameCtx): SprintState {
  return events.reduce((acc, ev) => reduce(acc, ev, ctx), init(ctx))
}
