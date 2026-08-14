import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { GameClock } from '../games/types'
import { setInputLocked } from '../lib/input'
import { useSound } from '../lib/sound'

/**
 * The beat before play.
 *
 * Read from the shared match clock rather than a local timer, so both players
 * count the same three seconds off the same server stamp — nothing extra
 * crosses the wire and neither side can start early.
 *
 * It ticks itself. The shell re-renders about once a second for presence, which
 * is far too coarse to land "3, 2, 1" on the beat.
 */
export function Countdown({ clock }: { clock: GameClock }) {
  const sound = useSound()
  const [left, setLeft] = useState(() => clock.countdown())

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setLeft(clock.countdown())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [clock])

  // Hold the global input lock for exactly as long as this is on screen, and
  // always release it on unmount — leaving it raised would silently deaden
  // every board in the app.
  const counting = left > 0
  useEffect(() => {
    setInputLocked(counting)
    return () => setInputLocked(false)
  }, [counting])

  // 3, 2, 1 — then "Go" for the last beat rather than a bare zero.
  const n = Math.ceil(left / 1000)
  const label = left <= 0 ? null : n <= 0 ? 'Go' : String(n)

  // One cue per number, keyed off the number itself so a dropped frame cannot
  // double-fire it.
  useEffect(() => {
    if (label) sound.play(label === 'Go' ? 'confirm' : 'tick')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label])

  return (
    <AnimatePresence>
      {label ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          className="absolute inset-0 z-30 grid place-items-center bg-bg/70 backdrop-blur-[3px]"
        >
          <AnimatePresence mode="popLayout">
            <motion.span
              key={label}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.5, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 26, mass: 0.7 }}
              className="display leading-none"
              style={{
                fontSize: label === 'Go' ? 'clamp(3rem, 16vw, 6rem)' : 'clamp(4rem, 22vw, 9rem)',
                color: label === 'Go' ? 'var(--t-accent)' : 'var(--t-ink)',
              }}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
