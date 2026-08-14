import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Press } from '../../../components/Press'
import { useGridKeys } from '../../../lib/input'
import { springSnap, springSoft } from '../../../lib/motion'
import { useSound } from '../../../lib/sound'
import type { SoloApi, SoloModule } from '../types'

/**
 * One square is a slightly different shade. Find it before the clock, and the
 * difference shrinks every level until it is barely there.
 *
 * The odd colour is produced with color-mix against the *accent* and the *ink*
 * rather than a fixed palette, which means the game automatically works in
 * whichever accent the player picked and in either theme, with no per-colour
 * tuning.
 */

const MAX_LEVEL_TIME = 6_000
const MIN_LEVEL_TIME = 3_200

/** Percentage of ink mixed into the accent. Smaller is harder. */
function deltaFor(level: number): number {
  return Math.max(2.2, 30 * Math.pow(0.86, level - 1))
}

function sizeFor(level: number): number {
  if (level <= 2) return 2
  if (level <= 5) return 3
  if (level <= 9) return 4
  if (level <= 14) return 5
  return 6
}

function timeFor(level: number): number {
  return Math.max(MIN_LEVEL_TIME, MAX_LEVEL_TIME - (level - 1) * 180)
}

function OddOnePlay({ api }: { api: SoloApi }) {
  const [level, setLevel] = useState(1)
  const sound = useSound()

  const size = sizeFor(level)
  const count = size * size
  // Re-rolled per level; `count` is in the deps so growing the grid moves it.
  const odd = useMemo(() => Math.floor(Math.random() * count), [level, count])
  const delta = deltaFor(level)
  const duration = timeFor(level)

  // Running out of time ends the run. Without this, the hard levels turn into
  // an untimed staring contest rather than a score chase.
  useEffect(() => {
    const id = setTimeout(() => api.end(), duration)
    return () => clearTimeout(id)
  }, [level, duration, api])

  const choose = useCallback(
    (index: number) => {
      if (index !== odd) {
        sound.play('foul')
        api.end()
        return
      }
      sound.play('pop')
      api.setScore(level)
      setLevel((l) => l + 1)
    },
    [odd, level, api, sound],
  )

  const boardRef = useRef<HTMLDivElement>(null)
  useGridKeys(boardRef, size, true)

  const base = 'var(--t-accent)'
  const oddColour = `color-mix(in srgb, var(--t-ink) ${delta.toFixed(2)}%, var(--t-accent))`

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-3 sm:px-6">
      <div className="flex items-baseline justify-between pb-3">
        <span className="chrome text-muted">Level {level}</span>
        <span className="chrome text-muted">{size}×{size}</span>
      </div>

      {/* Countdown for this level. Restarts on every level via the key. */}
      <div className="mb-3 h-[3px] overflow-hidden rounded-full bg-line">
        <motion.div
          key={level}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: duration / 1000, ease: 'linear' }}
          className="h-full origin-left bg-accent"
        />
      </div>

      <motion.div
        ref={boardRef}
        key={`${level}-${size}`}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={springSoft}
        className="grid gap-1.5 sm:gap-2"
        style={{
          gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
          maxWidth: 'min(100%, calc(100dvh - 17rem))',
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <Press
            key={i}
            cue={null}
            depth={0.93}
            aria-label={`Square ${i + 1}`}
            onPress={() => choose(i)}
            className="aspect-square rounded-lg"
            style={{ backgroundColor: i === odd ? oddColour : base }}
          />
        ))}
      </motion.div>

      <motion.p
        animate={{ opacity: level > 6 ? 0.45 : 1 }}
        transition={springSnap}
        className="pt-4 text-center text-[0.8125rem] text-muted short:hidden"
      >
        Tap the square that is a different shade.
      </motion.p>
    </div>
  )
}

export const oddOneGame: SoloModule = {
  meta: {
    id: 'oddone',
    title: 'Odd One Out',
    rule: 'One square is a slightly different shade — tap it before the timer, and it gets harder every level.',
    direction: 'high',
    unit: 'levels',
  },
  Play: OddOnePlay,
}
