import { scale } from '../../lib/difficulty'
import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import { DURATION_MS, EV_PULL } from './logic'

/**
 * A steady masher. Around 6.5 taps a second with drift, which a committed
 * human beats and a distracted one does not. Batched on the same cadence the
 * player's client uses, so neither side floods the log.
 */
const FLUSH_MS = 160
/** Taps per second, Gentle to Ruthless. A brisk human sits near 8. */
const RATE_EASY = 3.2
const RATE_HARD = 9.4

export const tugBot: BotFactory = () => {
  let planned = false

  return {
    react(_gameEvents, api, ctx) {
      if (planned) return
      planned = true

      const rand = mulberry32(ctx.seed ^ 0x7c9a)
      let carry = 0

      // Anchored to *now*, not to the match start.
      //
      // The schedule used to be laid out against `startedAt` and any slot that
      // had already gone by was skipped with `continue`. The first `react` does
      // not always land on the same tick as the start — a slow first frame, a
      // countdown, a rematch — and every millisecond of that gap silently ate
      // taps from the front. Far enough behind and every slot was in the past,
      // so the bot sat there doing nothing for the whole round, which is
      // exactly the glitch that was reported. Scheduling from now means a late
      // start costs a shorter round, never a dead opponent.
      const remaining = Math.max(0, DURATION_MS - (api.now() - ctx.startedAt))

      for (let t = FLUSH_MS; t < remaining; t += FLUSH_MS) {
        // Rate wobbles so it does not read as a metronome, and so the rope
        // visibly gives and takes rather than sliding at a constant speed.
        const rate = scale(ctx.difficulty, RATE_EASY, RATE_HARD) * (0.75 + rand() * 0.5)
        carry += (rate * FLUSH_MS) / 1000

        const taps = Math.floor(carry)
        if (taps <= 0) continue
        carry -= taps

        api.emit(EV_PULL, { n: taps }, t)
      }
    },
  }
}
