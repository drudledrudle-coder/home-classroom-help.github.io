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
      const lag = Math.max(0, api.now() - ctx.startedAt)
      let carry = 0

      for (let t = FLUSH_MS; t < DURATION_MS; t += FLUSH_MS) {
        // Rate wobbles so it does not read as a metronome, and so the rope
        // visibly gives and takes rather than sliding at a constant speed.
        const rate = scale(ctx.difficulty, RATE_EASY, RATE_HARD) * (0.75 + rand() * 0.5)
        carry += (rate * FLUSH_MS) / 1000

        const taps = Math.floor(carry)
        if (taps <= 0) continue
        carry -= taps

        const delay = t - lag
        if (delay < 0) continue
        api.emit(EV_PULL, { n: taps }, delay)
      }
    },
  }
}
