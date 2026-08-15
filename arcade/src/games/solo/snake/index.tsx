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
/**
 * Snake thickness in cell units.
 *
 * Thicker than it needs to be, because a fat snake turns better: the corner arc
 * is a fixed fraction of a cell, so the wider the body the more of the turn is
 * hidden inside its own width and the less the centre line's change of
 * direction reads as a hinge. Past about 0.9 the gaps between parallel runs
 * close up and the tail stops being legible behind the body.
 */
const THICKNESS = 0.86
/**
 * Corner radius in cell units. Half a cell is the most an arc can take without
 * cutting into the neighbouring segment, so the body rounds a corner as fully
 * as the geometry allows and the whole snake banks rather than hinging.
 */
const CORNER_R = 0.5

/**
 * How the head sweeps through a corner, as fractions of one tick.
 *
 * The head holds its old direction for the first quarter of the cell and then
 * eases round over the next sixty percent — so the snake drives *into* the
 * junction before it turns, the way it does in Google's. Rotating on the input
 * instead, as fast as the eye could follow, was technically the most responsive
 * thing to do and read as a twitch; a turn wants to look like momentum.
 *
 * Tied to the tick rather than to wall-clock time, so it stays in step with the
 * movement at every speed and always finishes inside its own cell.
 */
const TURN_DELAY = 0.1
const TURN_SPAN = 0.9

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
  const [crash, setCrash] = useState<{ x: number; y: number; wall: boolean } | null>(null)

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
   * The corner currently being swept: where the head started, and how far round
   * it is going. Both are set when a turn *commits*, on the tick.
   */
  const turnFrom = useRef(ANGLE.up)
  const turnDiff = useRef(0)

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
      // The cue is the immediate half of the answer, and deliberately the only
      // immediate half. It says the swipe landed without moving anything, so the
      // input can be acknowledged on this frame while the turn itself still
      // waits for the cell boundary.
      sound.play('tick')
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
      if (next) {
        heading.current = next
        // Start the sweep from wherever the head actually finished the last one
        // — which is the same thing, since a turn always completes inside its
        // cell, but stating it that way means a change to the timing constants
        // can never leave the head jumping back to an angle it had left.
        const at = turnFrom.current + turnDiff.current
        const to = ANGLE[next]
        turnFrom.current = at
        // Shortest way round, so turning left from north sweeps through west
        // rather than the long way through east.
        turnDiff.current = ((to - at + 540) % 360) - 180
      } else {
        // Straight on. The finished sweep has to be folded into the resting
        // angle here: the head's rotation is a function of progress through the
        // *current* cell, so leaving a completed turn in place would replay it
        // from the beginning the moment the next tick sent progress back to
        // zero — a head that swung out and snapped back, once per cell, for ever.
        turnFrom.current += turnDiff.current
        turnDiff.current = 0
      }

      const move = DELTA[heading.current]
      const head = { x: cells[0].x + move.x, y: cells[0].y + move.y }

      // Walls kill. No wrapping — that is the whole tension of the frame.
      const hitWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID
      const hitSelf = cells.some((c, i) => i < cells.length - 1 && key(c) === key(head))
      if (hitWall || hitSelf) {
        dead.current = true
        sound.play('foul')
        // Where it hit, clamped back onto the board so a wall crash blooms on
        // the edge it struck rather than off-screen where nobody can see it.
        setCrash({
          x: Math.max(0, Math.min(GRID - 1, head.x)) + 0.5,
          y: Math.max(0, Math.min(GRID - 1, head.y)) + 0.5,
          wall: hitWall,
        })
        // Long enough to read the crash, short enough not to sit between the
        // player and the result card.
        setTimeout(() => api.end(), 620)
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

    tickAt.current = performance.now()
    timerRef.current = setTimeout(step, tickMs.current)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
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
          // Driven by how far through the cell the snake is, not by elapsed
          // time: it holds, then eases round, then holds again — all within the
          // one cell the turn belongs to. Smoothstep rather than a linear sweep,
          // so the corner starts and finishes gently instead of snapping into
          // and out of a constant spin.
          const p = Math.max(0, Math.min(1, (t - TURN_DELAY) / TURN_SPAN))
          // Smootherstep, not smoothstep. Both start and end at zero velocity,
          // but this one also starts and ends at zero *acceleration* — there is
          // no instant where the rate of turn jumps, which is exactly what the
          // eye reads as stiffness at the two ends of a sweep.
          const eased = p * p * p * (p * (p * 6 - 15) + 10)
          const deg = turnFrom.current + turnDiff.current * eased

          const hx = cells[0].x + 0.5 + move.x * t
          const hy = cells[0].y + 0.5 + move.y * t
          head.setAttribute('transform', `translate(${hx} ${hy}) rotate(${deg})`)
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

      {/* The board takes the hit. A short, hard shake along the axis it was
          travelling would be better still, but a symmetric one reads correctly
          for a tail collision too, where there is no wall to bounce off. */}
      <motion.div
        animate={crash ? { x: [0, -7, 6, -3, 0], y: [0, 3, -2, 1, 0] } : { x: 0, y: 0 }}
        transition={{ duration: 0.34 }}
        className="relative aspect-square w-full overflow-hidden rounded-2xl border bg-surface"
        style={{
          maxWidth: 'min(100%, calc(100dvh - 16rem))',
          borderColor: crash ? 'var(--t-danger)' : 'var(--t-line)',
          transition: 'border-color 200ms linear',
        }}
      >
        <svg viewBox={`0 0 ${GRID} ${GRID}`} className="absolute inset-0 h-full w-full">
          {/* The apple lands, then breathes. A board where the only moving
              thing is the snake reads as a diagram; one slow idle gives the
              whole screen a pulse to sit against. */}
          <motion.circle
            key={`${apple.x},${apple.y}`}
            cx={apple.x + 0.5}
            cy={apple.y + 0.5}
            r={THICKNESS / 2}
            fill="var(--t-accent)"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: [1, 1.11, 1], opacity: 1 }}
            transition={{
              opacity: springSnap,
              scale: { duration: 1.9, repeat: Infinity, ease: 'easeInOut' },
            }}
            style={{ transformOrigin: `${apple.x + 0.5}px ${apple.y + 0.5}px` }}
          />

          {/* One stroked path for the whole body. The corners are curved in the
              path data itself, not just at the join, so the snake banks through
              a turn instead of pivoting on the spot. */}
          <path
            ref={pathRef}
            fill="none"
            stroke={crash ? 'var(--t-danger)' : 'var(--t-ink)'}
            strokeWidth={THICKNESS}
            style={{ transition: 'stroke 160ms linear' }}
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
            {/* A swallow, on the frame an apple goes down: the head swells and
                settles. Keyed on the count so it replays per apple, and inside
                the rotated group so it follows the head without fighting the
                transform written there every frame. */}
            <motion.g
              key={length}
              initial={length > 3 ? { scale: 1.34 } : false}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 17, mass: 0.5 }}
            >
              <circle
                r={THICKNESS / 2}
                fill={crash ? 'var(--t-danger)' : 'var(--t-ink)'}
                style={{ transition: 'fill 160ms linear' }}
              />
              <circle cx={0.1} cy={-0.155} r={0.082} fill="var(--t-surface)" />
              <circle cx={0.1} cy={0.155} r={0.082} fill="var(--t-surface)" />
            </motion.g>
          </g>

          {/* The crash.
              Three things at once, because an impact is not one event: the
              board recoils, a ring goes out from the point of contact, and
              shards come off it. Squares rather than a puff, so the debris
              reads as the snake itself coming apart — the same language Salvo's
              hits use. */}
          {crash ? (
            <g aria-hidden>
              <motion.circle
                cx={crash.x}
                cy={crash.y}
                fill="none"
                stroke="var(--t-danger)"
                strokeWidth={0.16}
                initial={{ r: THICKNESS / 2, opacity: 1 }}
                animate={{ r: 3.2, opacity: 0 }}
                transition={{ duration: 0.55, ease: 'easeOut' }}
              />
              {Array.from({ length: 10 }, (_, k) => {
                const angle = (k / 10) * Math.PI * 2 + 0.3
                const reach = 1.1 + (k % 3) * 0.42
                return (
                  <motion.rect
                    key={k}
                    width={0.24}
                    height={0.24}
                    fill="var(--t-danger)"
                    initial={{ x: crash.x - 0.12, y: crash.y - 0.12, opacity: 1 }}
                    animate={{
                      x: crash.x - 0.12 + Math.cos(angle) * reach,
                      y: crash.y - 0.12 + Math.sin(angle) * reach,
                      opacity: 0,
                    }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                )
              })}
            </g>
          ) : null}

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
      </motion.div>

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
