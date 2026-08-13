import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import { rackFor, spellableWords } from './dictionary'
import { DURATION_MS, EV_WORD } from './logic'

/**
 * Aims for a beatable-but-real showing: a dozen or so words, weighted towards
 * the short ones a person actually spots under time pressure, spread unevenly
 * across the round rather than on a metronome.
 */
const TARGET_WORDS = 13
const FIRST_WORD_MS = 2_600
/** Stop before the buzzer so the last word does not land after time. */
const LAST_WORD_MS = DURATION_MS - 3_000

export const sprintBot: BotFactory = () => {
  let planned = false

  return {
    react(_gameEvents, api, ctx) {
      if (planned) return
      planned = true

      const letters = rackFor(ctx.seed)
      if (!letters.length) return

      const rand = mulberry32(ctx.seed + 555)
      const pool = spellableWords(letters)
      if (!pool.length) return

      // Humans find short words first and rarely find the long ones at all.
      const short = pool.filter((w) => w.length <= 4)
      const mid = pool.filter((w) => w.length === 5)
      const long = pool.filter((w) => w.length >= 6)

      const picks: string[] = []
      const take = (from: string[], count: number) => {
        for (let i = 0; i < count && from.length; i++) {
          const word = from[Math.floor(rand() * from.length)]
          if (!picks.includes(word)) picks.push(word)
        }
      }
      take(short, Math.round(TARGET_WORDS * 0.6))
      take(mid, Math.round(TARGET_WORDS * 0.3))
      take(long, Math.round(TARGET_WORDS * 0.1))

      const span = LAST_WORD_MS - FIRST_WORD_MS
      // Delays are relative to now; the plan is relative to match start.
      const lag = Math.max(0, api.now() - ctx.startedAt)

      picks.forEach((word, i) => {
        // Even spacing plus jitter, so it never looks metronomic.
        const base = FIRST_WORD_MS + (span * i) / Math.max(1, picks.length - 1)
        const jitter = (rand() - 0.5) * (span / Math.max(2, picks.length))
        const delay = Math.round(base + jitter - lag)
        api.emit(EV_WORD, { w: word }, Math.max(400, delay))
      })
    },
  }
}
