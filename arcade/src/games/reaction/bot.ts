import { scale } from '../../lib/difficulty'
import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import { EV_TAP, replay, waitFor } from './logic'

/** Reaction time floor and spread, from Gentle to Ruthless. */
const BEST_EASY = 430
const BEST_HARD = 165
const SPREAD_EASY = 260
const SPREAD_HARD = 120
/** How often it jumps the gun; a gentle bot gifts more rounds this way. */
const FOUL_EASY = 0.2
const FOUL_HARD = 0.03

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
      const foulChance = scale(ctx.difficulty, FOUL_EASY, FOUL_HARD)

      if (rand() < foulChance) {
        // Jump early, exactly as a human does when the wait drags.
        api.emit(EV_TAP, { ms: 0, foul: true }, Math.floor(wait * (0.45 + rand() * 0.4)))
        return
      }

      const reaction = Math.round(
        scale(ctx.difficulty, BEST_EASY, BEST_HARD) +
          rand() * scale(ctx.difficulty, SPREAD_EASY, SPREAD_HARD),
      )
      // Emitted on a real delay so the opponent's result never lands before the
      // player's own screen has even flipped.
      api.emit(EV_TAP, { ms: reaction, foul: false }, wait + reaction)
    },
  }
}
