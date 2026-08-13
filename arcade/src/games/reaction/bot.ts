import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import { EV_TAP, replay, waitFor } from './logic'

/** Roughly a decent human: fast, beatable, occasionally jumps the gun. */
const BEST_MS = 185
const SPREAD_MS = 165
const FOUL_CHANCE = 0.06

export const reactionBot: BotFactory = () => {
  let scheduledRound = -1

  return {
    react(gameEvents, api, ctx) {
      const state = replay(gameEvents, { seed: ctx.seed, startedAt: ctx.startedAt, slot: 'guest' })
      if (state.phase === 'over') return
      // Already answered this round, or already queued an answer for it.
      if (state.taps.guest || scheduledRound === state.round) return

      scheduledRound = state.round
      const rand = mulberry32(ctx.seed + state.round * 104_729)
      const wait = waitFor(ctx.seed, state.round)

      if (rand() < FOUL_CHANCE) {
        // Jump early, exactly as a human does when the wait drags.
        api.emit(EV_TAP, { ms: 0, foul: true }, Math.floor(wait * (0.45 + rand() * 0.4)))
        return
      }

      const reaction = Math.round(BEST_MS + rand() * SPREAD_MS)
      // Emitted on a real delay so the opponent's result never lands before the
      // player's own screen has even flipped.
      api.emit(EV_TAP, { ms: reaction, foul: false }, wait + reaction)
    },
  }
}
