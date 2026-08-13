import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { springSnap } from '../../../lib/motion'
import { useDirectionInput } from '../../../lib/input'
import type { Dir } from '../../../lib/input'
import { useSound } from '../../../lib/sound'
import type { SoloApi, SoloModule } from '../types'

const GRID = 13
const START_MS = 190
const MIN_MS = 88
/** How much faster each apple makes it. */
const SPEEDUP_MS = 4
/** Snake thickness in cell units. */
const THICKNESS = 0.74

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

/**
 * The snake is simulated on a grid but drawn as one continuous rounded path,
 * interpolated between ticks.
 *
 * Drawing a square per cell makes the movement read as a series of jumps, which
 * is what "blocky" actually means here — it is the *stepping*, not the corners.
 * So the body is a polyline through cell centres with round caps and joins, and
 * every frame the head is pushed a fraction of a cell towards where it is going
 * while the tail retracts by the same fraction. The logic stays discrete; only
 * the rendering is continuous.
 *
 * The path is written straight to the SVG element from a rAF loop, so the
 * smoothing costs one attribute write per frame rather than a React render.
 */
function SnakePlay({ api }: { api: SoloApi }) {
  const sound = useSound()
  const [apple, setApple] = useState<Cell>({ x: 6, y: 3 })
  const [started, setStarted] = useState(false)
  const [length, setLength] = useState(3)

  const pathRef = useRef<SVGPolylineElement>(null)
  const headRef = useRef<SVGCircleElement>(null)

  const body = useRef<Cell[]>([
    { x: 6, y: 7 },
    { x: 6, y: 8 },
    { x: 6, y: 9 },
  ])
  const heading = useRef<Dir>('up')
  const queued = useRef<Dir[]>([])
  const grewThisTick = useRef(false)
  const tickAt = useRef(0)
  const tickMs = useRef(START_MS)
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

  /* -- simulation ---------------------------------------------------------- */
  useEffect(() => {
    if (!started || dead.current) return
    let timer: ReturnType<typeof setTimeout>

    const step = () => {
      const cells = body.current
      const next = queued.current.shift()
      if (next) heading.current = next

      const move = DELTA[heading.current]
      const head = { x: cells[0].x + move.x, y: cells[0].y + move.y }

      // Walls kill. No wrapping — that is the whole tension of the frame.
      const hitWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID
      const hitSelf = cells.some((c, i) => i < cells.length - 1 && key(c) === key(head))
      if (hitWall || hitSelf) {
        dead.current = true
        sound.play('foul')
        setTimeout(() => api.end(), 300)
        return
      }

      const ate = key(head) === key(apple)
      cells.unshift(head)
      grewThisTick.current = ate

      if (ate) {
        eaten.current += 1
        api.setScore(eaten.current)
        setLength(cells.length)
        sound.play('pop')
        setApple(placeApple(cells))
      } else {
        cells.pop()
      }

      tickAt.current = performance.now()
      tickMs.current = Math.max(MIN_MS, START_MS - eaten.current * SPEEDUP_MS)
      timer = setTimeout(step, tickMs.current)
    }

    tickAt.current = performance.now()
    timer = setTimeout(step, tickMs.current)
    return () => clearTimeout(timer)
  }, [started, apple, api, sound])

  /* -- rendering ----------------------------------------------------------- */
  useEffect(() => {
    let raf = 0

    const draw = (now: number) => {
      const cells = body.current
      const poly = pathRef.current
      if (poly && cells.length) {
        // Fraction of the way to the next cell, so the body glides rather than
        // hopping. Clamped, since a backgrounded tab can leave `now` far ahead.
        const t = dead.current
          ? 0
          : Math.max(0, Math.min(1, (now - tickAt.current) / tickMs.current))

        const move = DELTA[heading.current]
        const points: string[] = []

        // Head, pushed forward into the cell it is entering.
        points.push(`${cells[0].x + 0.5 + move.x * t},${cells[0].y + 0.5 + move.y * t}`)
        for (const c of cells) points.push(`${c.x + 0.5},${c.y + 0.5}`)

        // Tail, retracting by the same fraction — unless the snake just ate, in
        // which case it stays put and the body genuinely grows.
        if (!grewThisTick.current && cells.length >= 2) {
          const last = cells[cells.length - 1]
          const prev = cells[cells.length - 2]
          points[points.length - 1] =
            `${last.x + 0.5 + (prev.x - last.x) * t},${last.y + 0.5 + (prev.y - last.y) * t}`
        }

        poly.setAttribute('points', points.join(' '))

        const head = headRef.current
        if (head) {
          head.setAttribute('cx', String(cells[0].x + 0.5 + move.x * t))
          head.setAttribute('cy', String(cells[0].y + 0.5 + move.y * t))
        }
      }
      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-3 sm:px-6">
      <div className="flex items-baseline justify-between pb-3">
        <span className="chrome text-muted">Length {length}</span>
        <span className="chrome text-muted/60">Swipe or arrows</span>
      </div>

      <div
        className="relative aspect-square w-full overflow-hidden rounded-2xl border border-line bg-surface"
        style={{ maxWidth: 'min(100%, calc(100dvh - 16rem))' }}
      >
        <svg viewBox={`0 0 ${GRID} ${GRID}`} className="absolute inset-0 h-full w-full">
          <motion.circle
            cx={apple.x + 0.5}
            cy={apple.y + 0.5}
            r={THICKNESS / 2}
            fill="var(--t-accent)"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={springSnap}
            style={{ transformOrigin: `${apple.x + 0.5}px ${apple.y + 0.5}px` }}
          />

          {/* One stroked polyline for the whole body: round joins and caps mean
              the corners curve instead of stepping. */}
          <polyline
            ref={pathRef}
            fill="none"
            stroke="var(--t-ink)"
            strokeWidth={THICKNESS}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.92}
          />
          <circle ref={headRef} r={THICKNESS / 2} fill="var(--t-ink)" />
        </svg>

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
