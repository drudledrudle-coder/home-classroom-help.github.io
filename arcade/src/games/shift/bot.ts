import { scale } from '../../lib/difficulty'
import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import { EV_PLACE, replay, wouldWin } from './logic'
import type { ShiftState } from './logic'

/** Ranked fallback when there is nothing to win or block. */
const PREFERENCE = [4, 0, 2, 6, 8, 1, 3, 5, 7]
/** How often the bot passes up the best move, so it stays beatable. */
const SLOPPY_EASY = 0.62
const SLOPPY_HARD = 0.02

function chooseCell(state: ShiftState, rand: () => number, sloppiness: number): number {
  const empty = PREFERENCE.filter((cell) => state.board[cell] === null)
  if (!empty.length) return -1

  if (rand() > sloppiness) {
    const win = empty.find((cell) => wouldWin(state, 'guest', cell))
    if (win !== undefined) return win

    // Block only what the opponent can actually convert next turn — which
    // depends on their eviction, so it has to be simulated rather than guessed.
    const block = empty.find((cell) => wouldWin(state, 'host', cell))
    if (block !== undefined) return block
  }

  return empty[Math.floor(rand() * Math.min(empty.length, 3))] ?? empty[0]
}

export const shiftBot: BotFactory = () => {
  let pendingFor = -1

  return {
    react(gameEvents, api, ctx) {
      const state = replay(gameEvents, { seed: ctx.seed, startedAt: ctx.startedAt, slot: 'guest' })
      if (state.phase === 'over') return
      // Round resets are pushed by the host in every mode, including this one.
      if (state.roundOver) return
      if (state.turn !== 'guest') return
      if (pendingFor === gameEvents.length) return
      pendingFor = gameEvents.length

      const rand = mulberry32(ctx.seed + gameEvents.length * 31_337)
      const cell = chooseCell(state, rand, scale(ctx.difficulty, SLOPPY_EASY, SLOPPY_HARD))
      if (cell < 0) return

      // Long enough to read as deliberation, short enough not to stall.
      api.emit(EV_PLACE, { cell }, 480 + Math.floor(rand() * 520))
    },
  }
}
