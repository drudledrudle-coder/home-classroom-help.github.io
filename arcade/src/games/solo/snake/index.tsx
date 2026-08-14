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

/**
 * How far into a tick a turn may arrive and still be taken *now* rather than
 * next time.
 *
 * The grid is the honest model but it is not what the player thinks they are
 * doing: they swipe, and they expect the snake to turn. Past this point in the
 * tick the remaining wait is long enough to read as a dropped input, so the
 * pending step is simply brought forward. It costs nothing — the tick was about
 * to happen anyway — and it is the single biggest reason the controls feel
 * tight rather than laggy.
 */
const LATE_TURN = 0.55

/** Degrees the head sweeps per millisecond. 90° in about 70ms: read as instant. */
const TURN_RATE = 90 / 70

type Cell = { x: number; y: number }

/** Head glyph points along +x at zero, so these are clockwise from east. */
const ANGLE: Record<Dir, number> = { right: 0, down: 90, left: 180, up: 270 }

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
  const [burst, setBurst] = useState<{ n: number; x: number; y: number } | null>(null)

  const pathRef = useRef<SVGPathElement>(null)
  const headRef = useRef<SVGGElement>(null)

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

  /**
   * Where the head is *pointing*, which runs ahead of where the body is moving.
   *
   * The simulation can only turn on a tick, but the player turned when they
   * swiped. Pointing the head immediately gives the input somewhere to land on
   * the very next frame, so the grid underneath stops being the thing you feel.
   */
  const facing = useRef<Dir>('up')
  const angle = useRef(ANGLE.up)

  // Lets a turn pull the pending step forward; assigned by the simulation.
  const stepRef = useRef<() => void>(() => {})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const turn = useCallback(
    (dir: Dir) => {
      if (dead.current) return
      setStarted(true)
      const last = queued.current[queued.current.length - 1] ?? heading.current
      // Reversing into yourself is instant death, so it is treated as a misinput.
      if (dir === OPPOSITE[last] || dir === last) return
      if (queued.current.length >= 2) return

      queued.current.push(dir)
      // Answer on this frame: the head swings and a cue fires, both well before
      // the tick that actually moves anything.
      facing.current = dir
      sound.play('tick')

      // Late in the tick, take the step now rather than making them wait out a
      // gap they will read as the swipe being ignored.
      if (
        queued.current.length === 1 &&
        performance.now() - tickAt.current >= tickMs.current * LATE_TURN
      ) {
        if (timerRef.current) clearTimeout(timerRef.current)
        stepRef.current()
      }
    },
    [sound],
  )

  useDirectionInput(turn, true, true)

  /* -- simulation ---------------------------------------------------------- */
  useEffect(() => {
    if (!started || dead.current) return

    const step = () => {
      const cells = body.current
      const next = queued.current.shift()
      if (next) heading.current = next
      // Nothing queued: the head may have been pointed somewhere it never went
      // (a reversal, or a turn that arrived after this step). Put it back on the
      // heading so it never lies about where the snake is going.
      else facing.current = heading.current

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
        // A ring left where the apple was, so eating is felt at the point of
        // contact rather than only read off the counter.
        setBurst({ n: eaten.current, x: head.x + 0.5, y: head.y + 0.5 })
        setApple(placeApple(cells))
      } else {
        cells.pop()
      }

      tickAt.current = performance.now()
      tickMs.current = Math.max(MIN_MS, START_MS - eaten.current * SPEEDUP_MS)
      timerRef.current = setTimeout(step, tickMs.current)
    }

    stepRef.current = step
    tickAt.current = performance.now()
    timerRef.current = setTimeout(step, tickMs.current)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [started, apple, api, sound])

  /* -- rendering ----------------------------------------------------------- */
  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const draw = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
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
          // Swing towards where the player pointed, by the shortest way round,
          // at a rate that covers a right angle in about four frames. Started on
          // the input rather than on the tick, which is what makes a swipe feel
          // answered before anything has actually moved.
          const target = ANGLE[facing.current]
          const diff = ((target - angle.current + 540) % 360) - 180
          const stepBy = TURN_RATE * dt
          angle.current =
            Math.abs(diff) <= stepBy ? target : angle.current + Math.sign(diff) * stepBy
          angle.current = ((angle.current % 360) + 360) % 360

          const hx = cells[0].x + 0.5 + move.x * t
          const hy = cells[0].y + 0.5 + move.y * t
          head.setAttribute('transform', `translate(${hx} ${hy}) rotate(${angle.current})`)
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
          {/* The head, drawn pointing along +x and rotated into place. The eyes
              are the whole point: they give the snake a front, so a turn is
              legible as the animal looking where it is going rather than as a
              rectangle changing axis. They are cut out in the board colour, so
              they work in either theme and in every accent without tuning. */}
          <g ref={headRef}>
            <circle r={THICKNESS / 2} fill="var(--t-ink)" />
            <circle cx={0.1} cy={-0.155} r={0.082} fill="var(--t-surface)" />
            <circle cx={0.1} cy={0.155} r={0.082} fill="var(--t-surface)" />
          </g>

          {/* A ring left where an apple was taken. */}
          {burst ? (
            <motion.circle
              key={burst.n}
              cx={burst.x}
              cy={burst.y}
              fill="none"
              stroke="var(--t-accent)"
              strokeWidth={0.12}
              initial={{ r: THICKNESS / 2, opacity: 0.9 }}
              animate={{ r: 1.5, opacity: 0 }}
              transition={{ duration: 0.42, ease: 'easeOut' }}
              onAnimationComplete={() =>
                setBurst((b) => (b && b.n === burst.n ? null : b))
              }
            />
          ) : null}
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
    selfStart: true,
    unit: 'apples',
  },
  Play: SnakePlay,
}
