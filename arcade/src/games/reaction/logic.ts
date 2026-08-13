import type { MatchEvent, Slot } from '../../../shared/protocol'
import { mulberry32 } from '../../lib/random'
import type { BaseGameState, GameCtx } from '../types'

export const EV_TAP = 'tap'

export const ROUNDS_TO_WIN = 3
export const MAX_ROUNDS = 5
/** A round the player never answers is scored as this, rather than hanging. */
export const TAP_TIMEOUT_MS = 3_000

export type Tap = { ms: number; foul: boolean }

export type RoundResult = {
  host: Tap | null
  guest: Tap | null
  winner: Slot | 'tie'
}

export type ReactionState = BaseGameState & {
  round: number
  taps: Record<Slot, Tap | null>
  history: RoundResult[]
}

/**
 * The wait before the screen flips, derived from the shared seed so both
 * players get the same delay without anyone transmitting it.
 */
export function waitFor(seed: number, round: number): number {
  const rand = mulberry32(seed + round * 7_919)
  return 1_200 + Math.floor(rand() * 3_200)
}

export function init(): ReactionState {
  return {
    phase: 'playing',
    scores: { host: 0, guest: 0 },
    winner: null,
    round: 0,
    taps: { host: null, guest: null },
    history: [],
  }
}

/**
 * Fouls lose outright; otherwise the lower self-reported time wins.
 *
 * Both figures are measured by each client against *its own* flip, so neither
 * network latency nor clock skew is in the comparison — a player on a slow
 * connection is not penalised, and a fast one gains nothing.
 */
function judge(host: Tap, guest: Tap): Slot | 'tie' {
  if (host.foul && guest.foul) return 'tie'
  if (host.foul) return 'guest'
  if (guest.foul) return 'host'
  if (host.ms === guest.ms) return 'tie'
  return host.ms < guest.ms ? 'host' : 'guest'
}

export function reduce(state: ReactionState, event: MatchEvent, _ctx: GameCtx): ReactionState {
  if (state.phase === 'over') return state
  if (event.type !== EV_TAP || event.from === 'system') return state
  // First tap per player per round counts; later ones are duplicates from a
  // retry or a double press.
  if (state.taps[event.from]) return state

  const data = event.data as Partial<Tap> | undefined
  const tap: Tap = {
    ms: Math.max(0, Math.min(TAP_TIMEOUT_MS, Number(data?.ms ?? TAP_TIMEOUT_MS))),
    foul: !!data?.foul,
  }

  const taps = { ...state.taps, [event.from]: tap }
  if (!taps.host || !taps.guest) return { ...state, taps }

  const winner = judge(taps.host, taps.guest)
  const scores = { ...state.scores }
  if (winner !== 'tie') scores[winner] += 1

  const history = [...state.history, { host: taps.host, guest: taps.guest, winner }]
  const round = state.round + 1

  const decided =
    scores.host >= ROUNDS_TO_WIN || scores.guest >= ROUNDS_TO_WIN || round >= MAX_ROUNDS

  if (!decided) {
    return { ...state, scores, history, round, taps: { host: null, guest: null } }
  }

  return {
    ...state,
    phase: 'over',
    scores,
    history,
    round,
    taps: { host: null, guest: null },
    winner:
      scores.host === scores.guest ? 'tie' : scores.host > scores.guest ? 'host' : 'guest',
  }
}

/** Replays a log to state. Used by the bot, which has no React tree. */
export function replay(events: MatchEvent[], ctx: GameCtx): ReactionState {
  return events.reduce((acc, ev) => reduce(acc, ev, ctx), init())
}
