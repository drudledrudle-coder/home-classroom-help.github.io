import type { MatchEvent } from '../../../shared/protocol'
import { EV_TIMEUP } from '../../net/shellState'
import type { BaseGameState, GameCtx } from '../types'

export const EV_PULL = 'pull'
export const DURATION_MS = 10_000

/** Net taps needed to drag the marker fully over and end it early. */
export const WIN_MARGIN = 28
/** Guards against a tampered client claiming a thousand taps in one event. */
const MAX_PER_EVENT = 25

/** Scores are raw tap counts; the rope position is derived from the difference. */
export type TugState = BaseGameState

export function init(): TugState {
  return { phase: 'playing', scores: { host: 0, guest: 0 }, winner: null }
}

/**
 * Rope position from the point of view of whoever has `mine` taps: -1 is fully
 * dragged to the other side, +1 fully to theirs.
 *
 * Takes raw counts rather than the state so the view can pass *provisional*
 * ones — unflushed local taps, and taps heard over the hint channel before the
 * log caught up. The geometry is the same either way, and keeping it here means
 * the view does no arithmetic of its own.
 */
export function ropeToward(mine: number, theirs: number): number {
  return Math.max(-1, Math.min(1, (mine - theirs) / WIN_MARGIN))
}

/** -1 is fully to the guest's side, +1 fully to the host's. */
export function ropeAt(state: TugState): number {
  return ropeToward(state.scores.host, state.scores.guest)
}

function settle(state: TugState): TugState {
  const { host, guest } = state.scores
  return {
    ...state,
    phase: 'over',
    winner: host === guest ? 'tie' : host > guest ? 'host' : 'guest',
  }
}

export function reduce(state: TugState, event: MatchEvent, _ctx: GameCtx): TugState {
  if (state.phase === 'over') return state
  if (event.type === EV_TIMEUP) return settle(state)
  if (event.type !== EV_PULL || event.from === 'system') return state

  const raw = Number((event.data as { n?: number } | undefined)?.n)
  if (!Number.isFinite(raw)) return state
  const taps = Math.max(0, Math.min(MAX_PER_EVENT, Math.floor(raw)))
  if (!taps) return state

  const scores = { ...state.scores, [event.from]: state.scores[event.from] + taps }
  const next: TugState = { ...state, scores }

  // Dragging it all the way over ends it early — the whole point is that a
  // burst can finish the thing before the clock does.
  if (Math.abs(scores.host - scores.guest) >= WIN_MARGIN) {
    return {
      ...next,
      phase: 'over',
      winner: scores.host > scores.guest ? 'host' : 'guest',
    }
  }
  return next
}

export function replay(events: MatchEvent[], ctx: GameCtx): TugState {
  return events.reduce((acc, ev) => reduce(acc, ev, ctx), init())
}
