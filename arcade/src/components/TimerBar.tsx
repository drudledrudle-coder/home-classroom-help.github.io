import { useEffect, useRef } from 'react'
import type { GameClock } from '../games/types'
import { useSound } from '../lib/sound'

/**
 * Drives the countdown straight into the DOM from a rAF loop. A ticking React
 * state at 60fps would re-render the board on every frame, which is exactly
 * what must not happen while someone is tapping dots.
 */
export function TimerBar({
  clock,
  durationMs,
  running,
}: {
  clock: GameClock
  durationMs: number
  running: boolean
}) {
  const fillRef = useRef<HTMLDivElement>(null)
  const numRef = useRef<HTMLSpanElement>(null)
  const lastWhole = useRef(-1)
  const sound = useSound()

  useEffect(() => {
    let raf = 0
    const loop = () => {
      const left = clock.remaining() ?? durationMs
      const ratio = Math.max(0, Math.min(1, left / durationMs))

      if (fillRef.current) fillRef.current.style.transform = `scaleX(${ratio})`
      if (numRef.current) {
        // Tenths under ten seconds: the extra precision makes the last stretch
        // feel urgent without a change of layout, since the figures are tabular.
        numRef.current.textContent = left < 10_000 ? (left / 1000).toFixed(1) : Math.ceil(left / 1000).toFixed(0)
      }

      const whole = Math.ceil(left / 1000)
      if (running && whole !== lastWhole.current) {
        if (whole <= 5 && whole > 0 && lastWhole.current !== -1) sound.play('tick')
        lastWhole.current = whole
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [clock, durationMs, running, sound])

  return (
    <div className="flex items-center gap-3">
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
        <div
          ref={fillRef}
          className="h-full origin-left bg-accent"
          style={{ transform: 'scaleX(1)' }}
        />
      </div>
      <span ref={numRef} className="chrome tnum w-9 text-right text-muted" />
    </div>
  )
}
