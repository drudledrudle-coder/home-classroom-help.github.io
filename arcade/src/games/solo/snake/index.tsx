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
/**
 * Corner radius in cell units. Just under half a cell: large enough that a turn
 * is a visible arc rather than a chamfer, small enough that the body still
 * clearly follows the grid it is actually moving on.
 */
const CORNER_R = 0.46

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
 * Builds an SVG path through the points with the corners actually curved.
 *
 * `strokeLinejoin="round"` only rounds the *outside* of a join — the centre line
 * still turns through a hard right angle, so the snake reads as sliding
 * smoothly and then pivoting on the spot. Replacing each interior vertex with a
 * short quadratic through it curves the travel itself, which is what makes a
 * turn feel like a turn rather than a corner.
 *
 * The radius is clamped to half of each adjoining segment so it degrades
 * cleanly: the segment behind the head is fractional between ticks, and a fixed
 * radius there would overshoot and kink.
 */
function roundedPath(pts: Cell[], radius: number): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`

  const out: string[] = [`M${pts[0].x},${pts[0].y}`]

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const here = pts[i]
    const next = pts[i + 1]

    const inLen = Math.hypot(here.x - prev.x, here.y - prev.y)
    const outLen = Math.hypot(next.x - here.x, next.y - here.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)

    // Collinear or degenerate: nothing to round, so keep it a straight run.
    if (r < 0.001) {
      out.push(`L${here.x},${here.y}`)
      continue
    }

    const a = { x: here.x + ((prev.x - here.x) / inLen) * r, y: here.y + ((prev.y - here.y) / inLen) * r }
    const b = { x: here.x + ((next.x - here.x) / outLen) * r, y: here.y + ((next.y - here.y) / outLen) * r }

    out.push(`L${a.x.toFixed(3)},${a.y.toFixed(3)}`)
    out.push(`Q${here.x},${here.y} ${b.x.toFixed(3)},${b.y.toFixed(3)}`)
  }

  const last = pts[pts.length - 1]
  out.push(`L${last.x.toFixed(3)},${last.y.toFixed(3)}`)
  return out.join(' ')
}

/**
 * The snake is simulated on a grid but drawn as one continuous rounded path,
 * interpolated between ticks.
 *
 * Drawing a square per cell makes the movement read as a series of jumps, which
 * is what "blocky" actually means here — it is the *stepping*, not the corners.
 * So the body is one stroked path through cell centres, and every frame the head
 * is pushed a fraction of a cell towards where it is going while the tail
 * retracts by the same fraction. The logic stays discrete; only the rendering is
 * continuous. The corners are curved in the path data as well (see
 * `roundedPath`), so a turn banks rather than pivots.
 *
 * The path is written straight to the SVG element from a rAF loop, so the
 * smoothing costs one attribute write per frame rather than a React render.
 */
function SnakePlay({ api }: { api: SoloApi }) {
  const sound = useSound()
  const [apple, setApple] = useState<Cell>({ x: 6, y: 3 })
  const [started, setStarted] = useState(false)
  const [length, setLength] = useState(3)

  const pathRef = useRef<SVGPathElement>(null)
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
        const points: Cell[] = []

        // Head, pushed forward into the cell it is entering.
        points.push({ x: cells[0].x + 0.5 + move.x * t, y: cells[0].y + 0.5 + move.y * t })
        for (const c of cells) points.push({ x: c.x + 0.5, y: c.y + 0.5 })

        // Tail, retracting by the same fraction — unless the snake just ate, in
        // which case it stays put and the body genuinely grows.
        if (!grewThisTick.current && cells.length >= 2) {
          const last = cells[cells.length - 1]
          const prev = cells[cells.length - 2]
          points[points.length - 1] = {
            x: last.x + 0.5 + (prev.x - last.x) * t,
            y: last.y + 0.5 + (prev.y - last.y) * t,
          }
        }

        poly.setAttribute('d', roundedPath(points, CORNER_R))

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

          {/* One stroked path for the whole body. The corners are curved in the
              path data itself, not just at the join, so the snake banks through
              a turn instead of pivoting on the spot. */}
          <path
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
