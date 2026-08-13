import { scale } from '../../lib/difficulty'
import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import { EV_CLAIM, scheduleFor } from './logic'

/**
 * Share of dots the bot even attempts, and how long it takes to go for one.
 * Tuned so an attentive player comfortably wins and a distracted one does not —
 * at full attention it was taking roughly two thirds of the board.
 */
const ATTENTION_EASY = 0.2
const ATTENTION_HARD = 0.72
const REACTION_MIN_EASY = 620
const REACTION_MIN_HARD = 240
const REACTION_VAR_EASY = 520
const REACTION_VAR_HARD = 300

export const grabBot: BotFactory = () => {
  let planned = false

  return {
    react(_gameEvents, api, ctx) {
      if (planned) return
      planned = true

      const rand = mulberry32(ctx.seed ^ 0x9e37)
      // The schedule is measured from match start, but emit delays are measured
      // from now. Without this the whole plan drifts late by however long the
      // start event took to arrive.
      const lag = Math.max(0, api.now() - ctx.startedAt)

      const attention = scale(ctx.difficulty, ATTENTION_EASY, ATTENTION_HARD)
      const minReaction = scale(ctx.difficulty, REACTION_MIN_EASY, REACTION_MIN_HARD)
      const varReaction = scale(ctx.difficulty, REACTION_VAR_EASY, REACTION_VAR_HARD)

      for (const dot of scheduleFor(ctx.seed)) {
        if (rand() > attention) continue

        const reaction = minReaction + rand() * varReaction
        // Going for a dot it cannot reach in time would just be a dead event.
        if (reaction > dot.life * 0.9) continue

        const delay = Math.round(dot.at + reaction - lag)
        if (delay < 0) continue

        // Claims for dots the player already took are ignored by the reducer,
        // which is exactly what losing the race should look like.
        api.emit(EV_CLAIM, { id: dot.id }, delay)
      }
    },
  }
}
