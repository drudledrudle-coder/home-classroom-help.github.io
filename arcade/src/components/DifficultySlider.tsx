import { motion } from 'motion/react'
import { useCallback, useRef, useState } from 'react'
import { DIFFICULTIES, DIFFICULTY_LABEL, useDifficulty } from '../lib/difficulty'
import type { Difficulty } from '../lib/difficulty'
import { spring, springSnap } from '../lib/motion'
import { useSound } from '../lib/sound'

/**
 * A five-notch slider for how hard the bot plays.
 *
 * The pointer handling is ours rather than the range input's, which is the whole
 * point of this component. A native range thumb has to be *grabbed* on iOS
 * Safari — tapping or dragging the bare track moves nothing — and the thumb here
 * is invisible, so on an iPhone the control simply ignored most drags. The
 * native thumb also has width, so its travel is inset by half a thumb at each
 * end while the notches we draw sit at a true 0–100%; the two never quite lined
 * up even where dragging did work.
 *
 * So the track owns the gesture: press anywhere and it jumps to the nearest
 * notch and keeps tracking until release, on every platform. The range input
 * stays for the keyboard and the accessibility tree, with pointer events off.
 */
export function DifficultySlider() {
  const { difficulty, setDifficulty } = useDifficulty()
  const sound = useSound()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  // Tracks the committed level so a drag only ticks when it crosses a notch,
  // rather than on every pointermove. Kept in step with the context value so it
  // cannot drift if the level is changed from somewhere else.
  const lastRef = useRef(difficulty)
  lastRef.current = difficulty

  const pick = useCallback(
    (level: Difficulty) => {
      if (level === lastRef.current) return
      lastRef.current = level
      setDifficulty(level)
      sound.play('tick')
    },
    [setDifficulty, sound],
  )

  /** Nearest notch to a page x-coordinate. */
  const levelAt = useCallback((clientX: number): Difficulty | null => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return (Math.round(fraction * (DIFFICULTIES.length - 1)) + 1) as Difficulty
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      // Capture so the drag survives the finger leaving the track vertically,
      // which is most of them on a phone.
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
      const level = levelAt(event.clientX)
      if (level) pick(level)
    },
    [levelAt, pick],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const level = levelAt(event.clientX)
      if (level) pick(level)
    },
    [levelAt, pick],
  )

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }, [])

  const index = difficulty - 1
  const fill = (index / (DIFFICULTIES.length - 1)) * 100

  return (
    <div className="rounded-xl border border-line bg-surface px-4 pt-3 pb-3">
      <div className="flex items-baseline justify-between">
        <span className="chrome text-muted">Bot difficulty</span>
        <motion.span
          key={difficulty}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSnap}
          className="chrome text-accent"
        >
          {DIFFICULTY_LABEL[difficulty]}
        </motion.span>
      </div>

      {/* The padding is the hit area: the visible track is 3px, but the thing
          you can press is 44px tall, which is the minimum a thumb can rely on. */}
      <div
        className="relative -mx-1 mt-2 cursor-pointer px-1 py-5"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={trackRef} className="relative h-1.5">
          {/* Track */}
          <div className="absolute top-1/2 right-0 left-0 h-[3px] -translate-y-1/2 rounded-full bg-line" />
          <motion.div
            className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-accent"
            animate={{ width: `${fill}%` }}
            transition={spring}
          />

          {/* Notches */}
          {DIFFICULTIES.map((level, i) => {
            const at = (i / (DIFFICULTIES.length - 1)) * 100
            const reached = level <= difficulty
            const active = level === difficulty
            const size = active ? (dragging ? 20 : 16) : 6
            return (
              <motion.span
                key={level}
                className="absolute top-1/2 block rounded-full"
                style={{ left: `${at}%` }}
                animate={{
                  width: size,
                  height: size,
                  x: -size / 2,
                  y: -size / 2,
                  backgroundColor: reached ? 'var(--t-accent)' : 'var(--t-line-strong)',
                }}
                transition={spring}
              />
            )
          })}
        </div>

        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={difficulty}
          onChange={(e) => pick(Number(e.target.value) as Difficulty)}
          aria-label={`Bot difficulty: ${DIFFICULTY_LABEL[difficulty]}`}
          aria-valuetext={DIFFICULTY_LABEL[difficulty]}
          className="absolute inset-0 h-full w-full opacity-0"
          // The track above owns the gesture; this stays for keys and
          // assistive technology, and must not compete for the pointer.
          style={{ pointerEvents: 'none' }}
          tabIndex={0}
        />
      </div>

      <div className="flex justify-between">
        <span className="chrome text-muted/50">{DIFFICULTY_LABEL[1]}</span>
        <span className="chrome text-muted/50">{DIFFICULTY_LABEL[5]}</span>
      </div>
    </div>
  )
}
