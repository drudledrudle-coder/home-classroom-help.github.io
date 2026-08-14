import { motion, useSpring, useTransform } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { OTHER } from '../../../shared/protocol'
import { Press } from '../../components/Press'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import { EV_PULL, ropeToward } from './logic'
import type { TugState } from './logic'

/**
 * Longest a burst of taps may be held back before it goes to the log.
 *
 * This is a *budget* limit, not a pacing one. One event per tap would be twenty
 * events a second across both players, which is more than the log and the
 * function allowance are worth spending on a ten-second game. It no longer
 * costs any latency: the first tap of a burst is sent on the spot, and every
 * individual tap is mirrored to the other phone over the hint channel, so what
 * the batch delays is the bookkeeping rather than anything anyone can see.
 */
const FLUSH_MS = 160
/** Ephemeral hint carrying a running tap total. Never enters the log. */
const HINT_TAPS = 'tug:taps'
/** Keeps the marker off the very edge of the track. */
const TRAVEL = 45

export function TugView({ state, ctx, hints, send }: GameViewProps<TugState>) {
  const { slot, startedAt } = ctx
  const sound = useSound()
  const live = state.phase === 'playing'

  /**
   * Taps are counted locally and shipped in batches, but never *held* for one.
   *
   * The batch used to run on a free interval, so a single tap waited up to a
   * full `FLUSH_MS` before the transport was even asked to send it — on top of
   * the round trip. A lone tap is the entire interaction in this game, and that
   * wait was the whole of the delay it seemed to take to reach the other phone.
   */
  const unsent = useRef(0)
  const [localTaps, setLocalTaps] = useState(0)
  /** When the last event actually went out, for the leading-edge throttle. */
  const lastFlush = useRef(0)
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Our running tap total for this round; the payload of every hint. */
  const total = useRef(0)

  const flush = useCallback(() => {
    if (trailing.current) {
      clearTimeout(trailing.current)
      trailing.current = null
    }
    const n = unsent.current
    if (!n) return
    unsent.current = 0
    setLocalTaps(0)
    lastFlush.current = performance.now()
    send(EV_PULL, { n })
  }, [send])

  const tap = useCallback(() => {
    if (!live) return
    unsent.current += 1
    total.current += 1
    setLocalTaps(unsent.current)
    // Straight down the peer channel, one hint per tap. It costs nothing — no
    // function call, no log entry, no trip through the sequencer — so their
    // rope can move on the frame the finger lands rather than on the next
    // batch. The batched event still follows and still decides the score.
    hints.send(HINT_TAPS, { at: startedAt, n: total.current })
    sound.play('tick')

    const since = performance.now() - lastFlush.current
    if (since >= FLUSH_MS) {
      // First tap after a quiet spell: nothing to gain by waiting.
      flush()
    } else if (!trailing.current) {
      // Mid-burst. Let the batch fill, but guarantee the tail goes out even if
      // this turns out to be the last tap of the round.
      trailing.current = setTimeout(() => {
        trailing.current = null
        flush()
      }, FLUSH_MS - since)
    }
  }, [live, sound, hints, startedAt, flush])

  // Deliver whatever is left when play stops or the board goes away, so the
  // closing taps of a round are never dropped.
  useEffect(() => {
    if (!live) flush()
    return () => flush()
  }, [live, flush])

  // Space bar for desktop, where mashing a key beats mashing a mouse button.
  useEffect(() => {
    if (!live) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      event.preventDefault()
      if (!event.repeat) tap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live, tap])

  /**
   * Their tap total as of the last hint that reached us.
   *
   * The hint carries a running *total* rather than an increment, which is what
   * makes it safe on a channel that is deliberately unordered and unreliable: a
   * dropped hint is corrected by the next one, a late one can never drag the
   * rope backwards, and nothing has to be retired by hand — the confirmed log
   * simply overtakes it.
   */
  const [theirHint, setTheirHint] = useState(0)
  useEffect(() => {
    total.current = 0
    setTheirHint(0)
    return hints.subscribe((type, data) => {
      if (type !== HINT_TAPS) return
      const msg = data as { at?: number; n?: number } | undefined
      // A hint still in flight from the previous round must not seed this one.
      if (!msg || msg.at !== startedAt) return
      const n = Number(msg.n)
      if (Number.isFinite(n)) setTheirHint((prev) => Math.max(prev, n))
    })
  }, [hints, startedAt])

  const mine = state.scores[slot]
  const theirs = state.scores[OTHER[slot]]

  // Confirmed scores plus what each side has done that the log has not caught
  // up on: ours is the taps not yet flushed, theirs the highest hint we heard.
  // Both are decoration over the same authoritative numbers, and both are
  // overtaken as soon as the sequencer delivers the real events — so the rope
  // answers immediately without either side being able to fake a win. Once the
  // match is over only confirmed taps count, so the marker settles exactly
  // where the result card says it should.
  const toward = live
    ? ropeToward(mine + localTaps, Math.max(theirs, theirHint))
    : ropeToward(mine, theirs)

  // Firm enough to arrive within a few frames. The previous settings took about
  // a quarter of a second to travel, which reads as network delay even when the
  // tap got here instantly.
  const spring = useSpring(0, { stiffness: 520, damping: 34, mass: 0.32 })
  useEffect(() => {
    spring.set(toward)
  }, [spring, toward])

  const left = useTransform(spring, (v) => `${50 + v * TRAVEL}%`)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-3 pb-5 sm:px-6">
      <div className="flex items-baseline justify-between pb-2">
        <span className="chrome text-muted">Them</span>
        <span className="chrome text-accent">You</span>
      </div>

      <div className="relative h-16 overflow-hidden rounded-2xl border border-line bg-surface sm:h-20">
        <div className="absolute inset-y-3 left-1/2 w-px bg-line" />
        <motion.div
          style={{ left }}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <div
            className="grid h-11 w-11 place-items-center rounded-full sm:h-13 sm:w-13"
            style={{ backgroundColor: 'var(--t-accent)' }}
          >
            <span
              className="block h-2 w-2 rounded-full"
              style={{ backgroundColor: 'var(--t-accent-ink)' }}
            />
          </div>
        </motion.div>
      </div>

      <Press
        cue={null}
        depth={0.985}
        onPointerDown={tap}
        disabled={!live}
        aria-label="Tap to pull"
        className="no-select mt-4 flex flex-1 items-center justify-center rounded-3xl border border-line bg-surface"
        style={{ minHeight: 'min(34vh, 16rem)' }}
      >
        <div className="flex flex-col items-center gap-2.5">
          <span className="display text-[3rem] sm:text-[4rem]">TAP</span>
          <span className="chrome tnum text-muted">
            {mine} — {theirs}
          </span>
        </div>
      </Press>

      <p className="pt-3 text-center text-[0.8125rem] text-muted short:hidden">
        Drag it to your side. Space bar works too.
      </p>
    </div>
  )
}
