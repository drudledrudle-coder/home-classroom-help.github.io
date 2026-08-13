import type { MatchEvent, Slot } from '../../../shared/protocol'
import { OTHER } from '../../../shared/protocol'
import type { BaseGameState, GameCtx } from '../types'

export const EV_DROP = 'drop'
export const EV_NEXT = 'next'

export const COLS = 7
export const ROWS = 6
export const ROUNDS_TO_WIN = 2

/** Row 0 is the top; pieces settle at the highest index available. */
export const at = (row: number, col: number) => row * COLS + col

export type FourState = BaseGameState & {
  board: (Slot | null)[]
  turn: Slot
  line: readonly number[] | null
  roundOver: boolean
  roundWinner: Slot | 'tie' | null
}

export function init(): FourState {
  return {
    phase: 'playing',
    scores: { host: 0, guest: 0 },
    winner: null,
    board: Array(COLS * ROWS).fill(null),
    turn: 'host',
    line: null,
    roundOver: false,
    roundWinner: null,
  }
}

/** Lowest empty row in a column, or -1 when it is full. */
export function landingRow(board: (Slot | null)[], col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) if (!board[at(row, col)]) return row
  return -1
}

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const

/** The four-in-a-row through this cell, if there is one. */
function lineThrough(board: (Slot | null)[], row: number, col: number): number[] | null {
  const slot = board[at(row, col)]
  if (!slot) return null

  for (const [dr, dc] of DIRECTIONS) {
    const cells = [at(row, col)]
    for (const sign of [1, -1]) {
      let r = row + dr * sign
      let c = col + dc * sign
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[at(r, c)] === slot) {
        cells.push(at(r, c))
        r += dr * sign
        c += dc * sign
      }
    }
    if (cells.length >= 4) return cells
  }
  return null
}

/** Shared with the bot so its lookahead uses exactly the rules the reducer does. */
export function wouldWin(state: FourState, slot: Slot, col: number): boolean {
  const row = landingRow(state.board, col)
  if (row < 0) return false
  const board = state.board.slice()
  board[at(row, col)] = slot
  return lineThrough(board, row, col) !== null
}

export function reduce(state: FourState, event: MatchEvent, _ctx: GameCtx): FourState {
  if (state.phase === 'over' || event.from === 'system') return state

  if (event.type === EV_NEXT) {
    if (!state.roundOver) return state
    return {
      ...state,
      board: Array(COLS * ROWS).fill(null),
      // Whoever lost opens the next round.
      turn: state.roundWinner && state.roundWinner !== 'tie' ? OTHER[state.roundWinner] : state.turn,
      line: null,
      roundOver: false,
      roundWinner: null,
    }
  }

  if (event.type !== EV_DROP) return state
  if (state.roundOver || event.from !== state.turn) return state

  const col = Number((event.data as { col?: number } | undefined)?.col)
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return state

  const row = landingRow(state.board, col)
  if (row < 0) return state

  const board = state.board.slice()
  board[at(row, col)] = event.from
  const line = lineThrough(board, row, col)

  if (line) {
    const scores = { ...state.scores, [event.from]: state.scores[event.from] + 1 }
    const decided = scores[event.from] >= ROUNDS_TO_WIN
    return {
      ...state,
      board,
      line,
      roundOver: true,
      roundWinner: event.from,
      scores,
      phase: decided ? 'over' : 'playing',
      winner: decided ? event.from : null,
    }
  }

  // A full board with no line is a genuine draw; the round simply resets.
  if (board.every(Boolean)) {
    return { ...state, board, roundOver: true, roundWinner: 'tie', line: null }
  }

  return { ...state, board, turn: OTHER[event.from] }
}

export function replay(events: MatchEvent[], ctx: GameCtx): FourState {
  return events.reduce((acc, ev) => reduce(acc, ev, ctx), init())
}
