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
 * The squares are a **fixed** colour, and that is the whole point.
 *
 * They used to be the player's accent, with the odd one mixed towards the
 * theme's ink — which meant the game was a different game depending on the
 * settings. Mixing near-black into the near-white of the mono accent is a huge,
 * obvious shift; mixing the same percentage into a saturated red barely moves
 * it at all. The difficulty was decided by a colour picked for looks, and one
 * accent made the later levels unplayable while another made them trivial.
 *
 * So the board owns its own colour: one neutral, faintly cool grey that sits
 * comfortably on both a near-black and a near-white page and belongs to no
 * accent. Nothing else on the screen changes, so the theme still looks like the
 * theme — only the puzzle stops depending on it.
 */

const MAX_LEVEL_TIME = 6_000
const MIN_LEVEL_TIME = 3_200

/** Lightness and chroma of the board. Identical in every theme and accent. */
const BASE_L = 0.62
const BASE_C = 0.035
const BASE_H = 250

/**
 * How far the odd square's lightness is shifted, in OKLCH.
 *
 * OKLCH rather than sRGB because its lightness is roughly *perceptually*
 * uniform: a step of 0.02 looks like the same size of step wherever it lands,
 * which is what makes the difficulty curve mean something. The same step in
 * sRGB is far more visible in the light half of the range than the dark.
 */
function deltaFor(level: number): number {
  return Math.max(0.0055, 0.09 * Math.pow(0.86, level - 1))
}

const shade = (l: number) => `oklch(${l.toFixed(4)} ${BASE_C} ${BASE_H})`

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

function OddOnePlay({ api, running }: { api: SoloApi; running: boolean }) {
  const [level, setLevel] = useState(1)
  const sound = useSound()

  const size = sizeFor(level)
  const count = size * size
  // Re-rolled per level; `count` is in the deps so growing the grid moves it.
  const odd = useMemo(() => Math.floor(Math.random() * count), [level, count])
  // Lighter or darker, chosen per level. The shift is perceptually symmetric in
  // OKLCH, so this varies the look without varying the difficulty — and stops
  // "find the pale one" from being a strategy that skips the search.
  const lighter = useMemo(() => Math.random() < 0.5, [level])
  const delta = deltaFor(level)
  const duration = timeFor(level)

  // Running out of time ends the run. Without this, the hard levels turn into
  // an untimed staring contest rather than a score chase.
  //
  // The remaining time is carried by hand rather than left to the timeout,
  // because this effect re-runs on every pause. Restarting the full duration
  // each time would make pausing a way to never time out at all; resetting it
  // to zero would end the run on the first pause. So the level's own budget is
  // banked on the way out and resumed on the way back in.
  const left = useRef(duration)
  useEffect(() => {
    left.current = duration
  }, [level, duration])

  useEffect(() => {
    if (!running) return
    const startedAt = Date.now()
    const id = setTimeout(() => api.end(), left.current)
    return () => {
      clearTimeout(id)
      left.current = Math.max(0, left.current - (Date.now() - startedAt))
    }
  }, [level, running, api])

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

  const base = shade(BASE_L)
  const oddColour = shade(lighter ? BASE_L + delta : BASE_L - delta)

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
