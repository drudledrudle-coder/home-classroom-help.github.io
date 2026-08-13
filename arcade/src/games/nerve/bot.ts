import { scale } from '../../lib/difficulty'
import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import { EV_BANK, EV_FLIP, TILES, bombOdds, replay } from './logic'

/**
 * Plays the odds with a streak of greed. It banks once the risk of losing the
 * pot outweighs another tile, but the threshold drifts per turn so it sometimes
 * pushes further than it should — which is the whole appeal of watching an
 * opponent play this.
 */
export const nerveBot: BotFactory = () => {
  let pendingFor = -1

  return {
    react(gameEvents, api, ctx) {
      const state = replay(gameEvents, { seed: ctx.seed, startedAt: ctx.startedAt, slot: 'guest' })
      if (state.phase === 'over' || state.turn !== 'guest') return
      // One queued action per log state, or it would stack decisions.
      if (pendingFor === gameEvents.length) return
      pendingFor = gameEvents.length

      const rand = mulberry32(ctx.seed + state.turnIndex * 7_919 + state.revealed.length)
      const risk = bombOdds(state)
      const nerve = 0.9 + rand() * 0.5
      // A gentle bot misjudges the bet in both directions; a ruthless one
      // plays close to the true expected value.
      const judgement = scale(ctx.difficulty, 1.9, 3.4)

      const worthIt = state.pot === 0 || risk * state.pot < judgement * nerve

      if (!worthIt) {
        api.emit(EV_BANK, undefined, 620 + Math.floor(rand() * 500))
        return
      }

      const open: number[] = []
      for (let i = 0; i < TILES; i++) if (!state.revealed.includes(i)) open.push(i)
      if (!open.length) {
        api.emit(EV_BANK, undefined, 500)
        return
      }

      const pick = open[Math.floor(rand() * open.length)]
      // Slower when the pot is fat: the hesitation is half the fun to watch.
      const dither = state.pot > 8 ? 900 : 520
      api.emit(EV_FLIP, { i: pick }, dither + Math.floor(rand() * 460))
    },
  }
}
