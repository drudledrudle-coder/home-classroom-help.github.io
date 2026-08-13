import type { MatchEvent, Slot } from '../../../shared/protocol'
import { OTHER } from '../../../shared/protocol'
import type { BaseGameState, GameCtx } from '../types'

export const EV_PLACE = 'place'
export const EV_NEXT = 'next'

/** Three each, six on the board. Placing a fourth evicts your oldest. */
export const MAX_PIECES = 3
export const ROUNDS_TO_WIN = 2

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

export type ShiftState = BaseGameState & {
  board: (Slot | null)[]
  /** Cell indices in placement order, oldest first. */
  queues: Record<Slot, number[]>
  turn: Slot
  line: readonly number[] | null
  /** Round decided, waiting for the board to reset. */
  roundOver: boolean
  roundWinner: Slot | null
}

export function init(): ShiftState {
  return {
    phase: 'playing',
    scores: { host: 0, guest: 0 },
    winner: null,
    board: Array(9).fill(null),
    queues: { host: [], guest: [] },
    // Host opens the first round; afterwards the player who lost goes first.
    turn: 'host',
    line: null,
    roundOver: false,
    roundWinner: null,
  }
}

function lineFor(board: (Slot | null)[], slot: Slot): readonly number[] | null {
  for (const line of LINES) {
    if (line.every((i) => board[i] === slot)) return line
  }
  return null
}

/**
 * Places a piece and evicts the owner's oldest if they are over the limit.
 *
 * Order matters: place, then evict, then test for a line. Evicting first would
 * let a player win with a piece that should already have vanished.
 */
function place(
  board: (Slot | null)[],
  queues: Record<Slot, number[]>,
  slot: Slot,
  cell: number,
) {
  const nextBoard = board.slice()
  const nextQueue = [...queues[slot], cell]
  nextBoard[cell] = slot

  let evicted: number | null = null
  if (nextQueue.length > MAX_PIECES) {
    evicted = nextQueue.shift() as number
    nextBoard[evicted] = null
  }

  return {
    board: nextBoard,
    queues: { ...queues, [slot]: nextQueue } as Record<Slot, number[]>,
    evicted,
    line: lineFor(nextBoard, slot),
  }
}

/** Legality check shared by the reducer and the bot's lookahead. */
export function canPlace(state: ShiftState, slot: Slot, cell: number): boolean {
  if (state.phase === 'over' || state.roundOver) return false
  if (state.turn !== slot) return false
  if (cell < 0 || cell > 8) return false
  return state.board[cell] === null
}

/** Would this move complete a line, accounting for the eviction it triggers? */
export function wouldWin(state: ShiftState, slot: Slot, cell: number): boolean {
  if (state.board[cell] !== null) return false
  return place(state.board, state.queues, slot, cell).line !== null
}

/** The piece that vanishes on this player's next placement, if any. */
export function doomedCell(state: ShiftState, slot: Slot): number | null {
  return state.queues[slot].length >= MAX_PIECES ? state.queues[slot][0] : null
}

export function reduce(state: ShiftState, event: MatchEvent, _ctx: GameCtx): ShiftState {
  if (state.phase === 'over') return state
  if (event.from === 'system') return state

  if (event.type === EV_NEXT) {
    if (!state.roundOver) return state
    return {
      ...state,
      board: Array(9).fill(null),
      queues: { host: [], guest: [] },
      // The player who just lost opens the next round.
      turn: state.roundWinner ? OTHER[state.roundWinner] : state.turn,
      line: null,
      roundOver: false,
      roundWinner: null,
    }
  }

  if (event.type !== EV_PLACE) return state

  const cell = Number((event.data as { cell?: number } | undefined)?.cell)
  if (!Number.isInteger(cell) || !canPlace(state, event.from, cell)) return state

  const result = place(state.board, state.queues, event.from, cell)

  if (!result.line) {
    return {
      ...state,
      board: result.board,
      queues: result.queues,
      turn: OTHER[event.from],
    }
  }

  const scores = { ...state.scores, [event.from]: state.scores[event.from] + 1 }
  const decided = scores[event.from] >= ROUNDS_TO_WIN

  return {
    ...state,
    board: result.board,
    queues: result.queues,
    line: result.line,
    roundOver: true,
    roundWinner: event.from,
    scores,
    phase: decided ? 'over' : 'playing',
    winner: decided ? event.from : null,
  }
}

export function replay(events: MatchEvent[], ctx: GameCtx): ShiftState {
  return events.reduce((acc, ev) => reduce(acc, ev, ctx), init())
}
