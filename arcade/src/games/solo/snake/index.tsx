import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { springSnap } from '../../../lib/motion'
import { useDirectionInput } from '../../../lib/input'
import type { Dir } from '../../../lib/input'
import { useSound } from '../../../lib/sound'
import type { SoloApi, SoloModule } from '../types'

const GRID = 13
const START_MS = 190
const MIN_MS = 85
/** How much faster each apple makes it. */
const SPEEDUP_MS = 4

type Cell = { x: number; y: number }

const DELTA: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

const key = (c: Cell) => c.y * GRID + c.x

function placeApple(snake: Cell[]): Cell {
  const taken = new Set(snake.map(key))
  const open: Cell[] = []
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) if (!taken.has(y * GRID + x)) open.push({ x, y })
  return open[Math.floor(Math.random() * open.length)] ?? { x: 0, y: 0 }
}

function SnakePlay({ api }: { api: SoloApi }) {
  const sound = useSound()
  const [snake, setSnake] = useState<Cell[]>([
    { x: 6, y: 7 },
    { x: 6, y: 8 },
    { x: 6, y: 9 },
  ])
  const [apple, setApple] = useState<Cell>({ x: 6, y: 3 })
  const [started, setStarted] = useState(false)

  // Direction is held in refs: the tick reads it, and a queue means two quick
  // turns in one tick both register instead of the second overwriting the first.
  const heading = useRef<Dir>('up')
  const queued = useRef<Dir[]>([])
  const eaten = useRef(0)
  const dead = useRef(false)

  const turn = useCallback((dir: Dir) => {
    if (dead.current) return
    setStarted(true)
    const last = queued.current[queued.current.length - 1] ?? heading.current
    // Reversing into yourself is instant death, so it is treated as a misinput.
    if (dir === OPPOSITE[last] || dir === last) return
    if (queued.current.length < 2) queued.current.push(dir)
  }, [])

  useDirectionInput(turn, true)

  useEffect(() => {
    if (!started || dead.current) return
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      setSnake((current) => {
        if (dead.current) return current

        const next = queued.current.shift()
        if (next) heading.current = next
        const step = DELTA[heading.current]
        const head = { x: current[0].x + step.x, y: current[0].y + step.y }

        // Walls kill. No wrapping — that is the whole tension of the frame.
        const hitWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID
        const hitSelf = current.some((c, i) => i < current.length - 1 && key(c) === key(head))
        if (hitWall || hitSelf) {
          dead.current = true
          sound.play('foul')
          setTimeout(() => api.end(), 260)
          return current
        }

        const ate = key(head) === key(apple)
        const grown = [head, ...current]
        if (ate) {
          eaten.current += 1
          api.setScore(eaten.current)
          sound.play('pop')
          setApple(placeApple(grown))
        } else {
          grown.pop()
        }
        return grown
      })

      const delay = Math.max(MIN_MS, START_MS - eaten.current * SPEEDUP_MS)
      timer = setTimeout(tick, delay)
    }

    timer = setTimeout(tick, START_MS)
    return () => clearTimeout(timer)
  }, [started, apple, api, sound])

  const unit = 100 / GRID

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-3 sm:px-6">
      <div className="flex items-baseline justify-between pb-3">
        <span className="chrome text-muted">Length {snake.length}</span>
        <span className="chrome text-muted/60">Swipe or arrows</span>
      </div>

      <div
        className="relative aspect-square w-full overflow-hidden rounded-2xl border border-line bg-surface"
        style={{ maxWidth: 'min(100%, calc(100dvh - 16rem))' }}
      >
        <motion.div
          animate={{ scale: 1 }}
          className="absolute rounded-full"
          style={{
            left: `${apple.x * unit}%`,
            top: `${apple.y * unit}%`,
            width: `${unit}%`,
            height: `${unit}%`,
            padding: '0.15rem',
          }}
        >
          <motion.span
            animate={{ scale: [1, 0.82, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className="block h-full w-full rounded-full"
            style={{ backgroundColor: 'var(--t-accent)' }}
          />
        </motion.div>

        {snake.map((cell, i) => (
          <div
            key={`${i}-${key(cell)}`}
            className="absolute"
            style={{
              left: `${cell.x * unit}%`,
              top: `${cell.y * unit}%`,
              width: `${unit}%`,
              height: `${unit}%`,
              padding: '0.09rem',
            }}
          >
            <div
              className="h-full w-full"
              style={{
                backgroundColor: 'var(--t-ink)',
                opacity: i === 0 ? 1 : Math.max(0.35, 1 - i * 0.035),
                borderRadius: i === 0 ? '0.3rem' : '0.2rem',
              }}
            />
          </div>
        ))}

        {!started ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={springSnap}
            className="absolute inset-0 grid place-items-center bg-surface/70 backdrop-blur-[2px]"
          >
            <span className="chrome text-muted">Swipe to start</span>
          </motion.div>
        ) : null}
      </div>

      <p className="pt-4 text-center text-[0.8125rem] text-muted short:hidden">
        Eat the dot. The walls and your own tail are fatal.
      </p>
    </div>
  )
}

export const snakeGame: SoloModule = {
  meta: {
    id: 'snake',
    title: 'Snake',
    rule: 'Eat the dot to grow — hit a wall or your own tail and the run is over.',
    direction: 'high',
    unit: 'apples',
  },
  Play: SnakePlay,
}
