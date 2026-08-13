import { scale } from '../../lib/difficulty'
import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import { COLS, EV_DROP, landingRow, replay, wouldWin } from './logic'
import type { FourState } from './logic'

/** Centre columns are worth more; classic connect-four heuristic. */
const WEIGHT = [1, 2, 4, 6, 4, 2, 1]
/** How often it passes up the correct move, so it stays beatable. */
const SLOPPY_EASY = 0.6
const SLOPPY_HARD = 0.02

function choose(state: FourState, rand: () => number, sloppiness: number): number {
  const open: number[] = []
  for (let c = 0; c < COLS; c++) if (landingRow(state.board, c) >= 0) open.push(c)
  if (!open.length) return -1

  if (rand() > sloppiness) {
    const win = open.find((c) => wouldWin(state, 'guest', c))
    if (win !== undefined) return win

    const block = open.find((c) => wouldWin(state, 'host', c))
    if (block !== undefined) return block
  }

  // Otherwise lean centre, with enough noise that it does not play identically
  // every game.
  let best = open[0]
  let bestScore = -Infinity
  for (const c of open) {
    const score = WEIGHT[c] + rand() * 3
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

export const fourBot: BotFactory = () => {
  let pendingFor = -1

  return {
    react(gameEvents, api, ctx) {
      const state = replay(gameEvents, { seed: ctx.seed, startedAt: ctx.startedAt, slot: 'guest' })
      if (state.phase === 'over' || state.roundOver) return
      if (state.turn !== 'guest') return
      if (pendingFor === gameEvents.length) return
      pendingFor = gameEvents.length

      const rand = mulberry32(ctx.seed + gameEvents.length * 6_151)
      const col = choose(state, rand, scale(ctx.difficulty, SLOPPY_EASY, SLOPPY_HARD))
      if (col < 0) return

      api.emit(EV_DROP, { col }, 520 + Math.floor(rand() * 560))
    },
  }
}
