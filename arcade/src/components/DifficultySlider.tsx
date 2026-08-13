import { motion } from 'motion/react'
import { useCallback, useRef } from 'react'
import { DIFFICULTIES, DIFFICULTY_LABEL, useDifficulty } from '../lib/difficulty'
import type { Difficulty } from '../lib/difficulty'
import { spring, springSnap } from '../lib/motion'
import { useSound } from '../lib/sound'

/**
 * A five-notch slider for how hard the bot plays.
 *
 * Built on a real range input rather than a div: that gives keyboard control,
 * screen-reader semantics and native dragging for free. The input is made
 * invisible and stretched over the track, and everything visible underneath is
 * driven from its value — so the thing you drag is the thing assistive
 * technology sees.
 */
export function DifficultySlider() {
  const { difficulty, setDifficulty } = useDifficulty()
  const sound = useSound()
  const last = useRef(difficulty)

  const pick = useCallback(
    (level: Difficulty) => {
      if (level === last.current) return
      last.current = level
      setDifficulty(level)
      sound.play('tick')
    },
    [setDifficulty, sound],
  )

  const index = difficulty - 1
  const fill = (index / (DIFFICULTIES.length - 1)) * 100

  return (
    <div className="rounded-xl border border-line bg-surface px-4 pt-3 pb-4">
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

      <div className="relative mt-4 h-6">
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
          return (
            <motion.span
              key={level}
              className="absolute top-1/2 block rounded-full"
              style={{ left: `${at}%` }}
              animate={{
                width: level === difficulty ? 16 : 6,
                height: level === difficulty ? 16 : 6,
                x: level === difficulty ? -8 : -3,
                y: level === difficulty ? -8 : -3,
                backgroundColor: reached ? 'var(--t-accent)' : 'var(--t-line-strong)',
              }}
              transition={spring}
            />
          )
        })}

        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={difficulty}
          onChange={(e) => pick(Number(e.target.value) as Difficulty)}
          aria-label={`Bot difficulty: ${DIFFICULTY_LABEL[difficulty]}`}
          aria-valuetext={DIFFICULTY_LABEL[difficulty]}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <div className="mt-1.5 flex justify-between">
        <span className="chrome text-muted/50">{DIFFICULTY_LABEL[1]}</span>
        <span className="chrome text-muted/50">{DIFFICULTY_LABEL[5]}</span>
      </div>
    </div>
  )
}
