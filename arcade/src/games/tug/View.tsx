import { motion, useSpring, useTransform } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { OTHER } from '../../../shared/protocol'
import { Press } from '../../components/Press'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import { EV_PULL, WIN_MARGIN, ropeAt } from './logic'
import type { TugState } from './logic'

/** How often un-sent taps are flushed to the log. */
const FLUSH_MS = 160
/** Keeps the marker off the very edge of the track. */
const TRAVEL = 45

export function TugView({ state, ctx, send }: GameViewProps<TugState>) {
  const { slot } = ctx
  const sound = useSound()
  const live = state.phase === 'playing'

  /**
   * Taps are counted locally and shipped in batches. One event per tap would be
   * roughly twenty events a second across both players — enough to blow through
   * the log cap and the function budget in a single ten-second game.
   */
  const unsent = useRef(0)
  const [localTaps, setLocalTaps] = useState(0)

  const flush = useCallback(() => {
    const n = unsent.current
    if (!n) return
    unsent.current = 0
    setLocalTaps(0)
    send(EV_PULL, { n })
  }, [send])

  useEffect(() => {
    if (!live) {
      flush()
      return
    }
    const id = setInterval(flush, FLUSH_MS)
    return () => {
      clearInterval(id)
      flush()
    }
  }, [live, flush])

  const tap = useCallback(() => {
    if (!live) return
    unsent.current += 1
    setLocalTaps(unsent.current)
    sound.play('tick')
  }, [live, sound])

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

  // Confirmed position plus taps not yet flushed, so the rope answers the
  // finger on the same frame rather than on the next batch. Signed so positive
  // always means "towards me", whichever side I am.
  const pending = (slot === 'host' ? localTaps : -localTaps) / WIN_MARGIN
  const rope = Math.max(-1, Math.min(1, ropeAt(state) + pending))
  const toward = slot === 'host' ? rope : -rope

  const spring = useSpring(0, { stiffness: 300, damping: 28, mass: 0.5 })
  useEffect(() => {
    spring.set(toward)
  }, [spring, toward])

  const left = useTransform(spring, (v) => `${50 + v * TRAVEL}%`)
  const mine = state.scores[slot]
  const theirs = state.scores[OTHER[slot]]

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
