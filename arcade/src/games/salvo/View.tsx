import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { OTHER } from '../../../shared/protocol'
import { Button } from '../../components/Button'
import { Press } from '../../components/Press'
import { useGridKeys } from '../../lib/input'
import { spring, springSnap, springSoft } from '../../lib/motion'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import {
  EV_READY,
  EV_RESULT,
  EV_SHOT,
  GRID,
  SHIPS,
  alreadyShot,
  bothReady,
  defenderOf,
  fits,
  loadFleet,
  makeFleet,
  markOffSizes,
  regroup,
  saveFleet,
  shipCells,
  sunkBy,
} from './logic'
import type { SalvoState } from './logic'

/**
 * The board is capped by width and by the height actually left over, and the
 * labels above it are capped to the same number so they line up with its edges.
 * Previously the grid alone carried the cap, so whenever height was the binding
 * constraint the board shrank while its header stayed full width and the whole
 * screen looked off-centre — and in phone landscape the old `100dvh - 22rem`
 * left 38px, collapsing the board to a stamp. A floor keeps it playable and the
 * shell scrolls if it genuinely does not fit.
 */
const BOARD_CAP = 'max(15rem, min(100%, calc(100dvh - 20rem)))'

/**
 * The placement board is capped by classes rather than an inline style so the
 * `short` variant can override it — inline styles would win over any class.
 * Held sideways there is no room for a board *and* its controls stacked, and the
 * Ready button ended up below the fold, so a phone in landscape puts the board
 * and the controls side by side instead and sizes the board by height.
 */
const PLACE_BOARD =
  'w-full max-w-[max(13rem,min(100%,calc(100dvh-24rem)))] short:max-w-[min(46vw,calc(100dvh-11rem))]'

export function SalvoView({ state, ctx, settled, send }: GameViewProps<SalvoState>) {
  const { slot } = ctx
  const sound = useSound()
  const theirSlot = OTHER[slot]

  const placing = !state.ready[slot]
  const waiting = state.ready[slot] && !bothReady(state)

  /* -- fleet: chosen here, never transmitted -------------------------------- */
  // A stored fleet is only trusted if it still splits back into three legal
  // ships. Anything else (a half-written entry, a change to SHIPS) is discarded
  // rather than restored, since a fleet the placement board cannot represent
  // would show an empty grid while still answering hits from the old ships.
  const [fleet, setFleet] = useState<number[]>(() => {
    const stored = loadFleet(ctx.startedAt)
    return stored && regroup(stored).length === SHIPS.length ? stored : []
  })
  const commitFleet = useCallback(
    (next: number[]) => {
      setFleet(next)
      saveFleet(ctx.startedAt, next)
    },
    [ctx.startedAt],
  )

  /** Our own ships as separate vessels — what makes a sinking knowable. */
  const ships = useMemo(() => regroup(fleet), [fleet])

  const myTurn = state.turn === slot && !state.pending && state.phase === 'playing' && bothReady(state)

  // Answer any shot aimed at us. Only this client knows where its ships are, so
  // only this client can say whether it was a hit — or whether that hit was the
  // one that finished a ship off.
  const answeredFor = useRef(-1)
  useEffect(() => {
    if (state.phase === 'over') return
    // Only answer a shot the sequencer has actually ordered. Over the direct
    // channel a shot can arrive within a few milliseconds, and answering that
    // fast put the result into the log *ahead* of the shot it answered — the
    // reducer then dropped it for having nothing pending, and the shot hung
    // for ever.
    if (!settled) return
    if (defenderOf(state) !== slot || !state.pending) return
    if (answeredFor.current === state.pending.i) return
    answeredFor.current = state.pending.i

    const i = state.pending.i
    const hit = fleet.includes(i)
    // Naming the cells is safe: a ship only sinks once the attacker has hit
    // every one of them, so this tells them nothing they did not already know.
    const struck = new Set(state.shots[theirSlot].filter((s) => s.hit).map((s) => s.i))
    const sunk = hit ? (sunkBy(ships, struck, i) ?? undefined) : undefined

    const id = setTimeout(() => send(EV_RESULT, { i, hit, sunk }), 260)
    return () => clearTimeout(id)
  }, [state, settled, slot, theirSlot, fleet, ships, send])

  if (placing) {
    return (
      <PlacementBoard
        fleet={fleet}
        onChange={commitFleet}
        onDone={() => send(EV_READY)}
        sound={sound}
      />
    )
  }

  return (
    <FiringBoard
      state={state}
      slot={slot}
      theirSlot={theirSlot}
      fleet={fleet}
      ships={ships}
      myTurn={myTurn}
      waiting={waiting}
      send={send}
      sound={sound}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Placing                                                                     */
/* -------------------------------------------------------------------------- */

type Sound = ReturnType<typeof useSound>

/** A drag in progress, whether it came from the tray or off the board. */
type Drag = {
  size: number
  /** Index into `placed` when an existing ship is being moved, else null. */
  from: number | null
  /** Where the gesture began, so a press-and-release in place still lifts. */
  origin: number
  /** The cell the bow currently sits under. */
  cell: number
}

/**
 * Drag a ship into place, or tap to drop it — both do the same thing, and both
 * work on the same surface.
 *
 * Dragging is the gesture people reach for and it shows the ship moving with the
 * thumb, with a live preview that turns red where it will not fit. Tapping is
 * faster once you know the board, and it is what the keyboard path uses, so
 * neither is second class: a press and release on one square is simply a drag
 * that travelled nowhere.
 */
function PlacementBoard({
  fleet,
  onChange,
  onDone,
  sound,
}: {
  fleet: number[]
  onChange: (next: number[]) => void
  onDone: () => void
  sound: Sound
}) {
  // Ships as separate runs, so one can be lifted without disturbing the others.
  const [placed, setPlaced] = useState<number[][]>(() => regroup(fleet))
  const [horizontal, setHorizontal] = useState(true)
  const [rejected, setRejected] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)

  const boardRef = useRef<HTMLDivElement>(null)
  useGridKeys(boardRef, GRID, true)

  // A ship being moved is treated as already off the board, so it can be
  // dropped overlapping where it currently sits without colliding with itself.
  const lifted = drag?.from ?? null
  const onBoard = useMemo(() => placed.filter((_, k) => k !== lifted), [placed, lifted])
  const taken = useMemo(() => onBoard.flat(), [onBoard])

  const nextSize = SHIPS[placed.length]
  const done = placed.length === SHIPS.length

  const commit = useCallback(
    (ships: number[][]) => {
      setPlaced(ships)
      onChange(ships.flat().sort((a, b) => a - b))
    },
    [onChange],
  )

  const reject = useCallback(() => {
    sound.play('foul')
    setRejected(true)
    setTimeout(() => setRejected(false), 260)
  }, [sound])

  /** Where the ship would land right now, and whether it may. */
  const preview = drag ? shipCells(drag.cell, drag.size, horizontal) : null
  const previewOk = preview ? fits(preview, taken) : false
  const previewSet = useMemo(() => new Set(preview ?? []), [preview])

  /* -- pointer: one gesture covers tap, drag and lift ----------------------- */

  const cellAt = useCallback((clientX: number, clientY: number): number | null => {
    const el = boardRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    const col = Math.floor(((clientX - r.left) / r.width) * GRID)
    const row = Math.floor(((clientY - r.top) / r.height) * GRID)
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return null
    return row * GRID + col
  }, [])

  // The gesture is tracked in a ref as well as in state. State is what the board
  // renders from; the ref is what decides, because pointerup can reach us twice
  // (the window listener below, plus a cancel) and both copies would read the
  // same stale state and place the ship twice. Clearing the ref is synchronous,
  // so the second call finds nothing to do.
  const dragRef = useRef<Drag | null>(null)
  const hold = useCallback((next: Drag | null) => {
    dragRef.current = next
    setDrag(next)
  }, [])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const i = cellAt(e.clientX, e.clientY)
      if (i == null) return
      const held = placed.findIndex((ship) => ship.includes(i))
      // Nothing here and nothing left in the tray: no gesture to start.
      if (held < 0 && done) return

      if (held >= 0) {
        // Pick it up in the orientation it is already lying in, so a move does
        // not silently rotate it — and so the toggle reflects what you hold.
        setHorizontal(placed[held][1] - placed[held][0] === 1)
      }
      // Capture keeps events coming if the finger wanders off the grid, but it
      // throws outright when the pointer is no longer active, and an exception
      // here would abandon the gesture before it began. The window listeners
      // cover the same ground, so this is a bonus rather than a requirement.
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* tracked on the window instead */
      }
      hold({
        size: held >= 0 ? placed[held].length : nextSize,
        from: held >= 0 ? held : null,
        origin: i,
        cell: i,
      })
      sound.play('tick')
    },
    [cellAt, placed, done, nextSize, hold, sound],
  )

  const track = useCallback(
    (clientX: number, clientY: number) => {
      const current = dragRef.current
      if (!current) return
      const i = cellAt(clientX, clientY)
      // Off the board: hold the last good square rather than snapping away.
      // A tick per square crossed is what makes the drag feel notched.
      if (i == null || i === current.cell) return
      hold({ ...current, cell: i })
      sound.play('tick')
    },
    [cellAt, hold, sound],
  )

  const finish = useCallback(() => {
    const current = dragRef.current
    if (!current) return
    const { from, cell, origin, size } = current
    hold(null)

    // Pressed and released on the same square of a ship already down: lift it.
    if (from != null && cell === origin) {
      sound.play('tap')
      commit(placed.filter((_, k) => k !== from))
      return
    }

    const cells = shipCells(cell, size, horizontal)
    if (!fits(cells, placed.filter((_, k) => k !== from).flat())) {
      reject()
      return
    }

    sound.play('pop')
    // A moved ship keeps its slot, so the tray order never shuffles under you.
    commit(from != null ? placed.map((sh, k) => (k === from ? cells : sh)) : [...placed, cells])
  }, [placed, horizontal, hold, commit, reject, sound])

  // Tracked on the window for the length of the gesture. Without this a finger
  // that leaves the board — which is most of them, since the ship you are
  // dragging sits under your thumb near the edge — would strand the preview
  // with no way to drop it.
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => track(e.clientX, e.clientY)
    const cancel = () => hold(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [drag, track, finish, hold])

  /**
   * The keyboard path only. Real pointer activation is handled above, and
   * routing it here as well would place two ships for one tap — a click
   * synthesised from a keypress is the one with no pointer behind it.
   */
  const activate = useCallback(
    (i: number) => {
      const held = placed.findIndex((ship) => ship.includes(i))
      if (held >= 0) {
        sound.play('tap')
        commit(placed.filter((_, k) => k !== held))
        return
      }
      if (done) return
      const cells = shipCells(i, nextSize, horizontal)
      if (!fits(cells, taken)) {
        reject()
        return
      }
      sound.play('pop')
      commit([...placed, cells])
    },
    [placed, done, nextSize, horizontal, taken, commit, reject, sound],
  )

  /**
   * Turn a ship that is already down, in place.
   *
   * Rotating around the bow rather than the centre, because the bow is the cell
   * the player put their finger on and is the one they think of the ship as
   * occupying. If the turned ship would run off the board `shipCells` clamps it
   * back inside; if it would land on another ship the move is refused, since
   * silently shoving the other one aside is worse than doing nothing.
   */
  const rotateAt = useCallback(
    (index: number) => {
      const ship = placed[index]
      if (!ship) return
      const across = ship[1] - ship[0] === 1
      const cells = shipCells(ship[0], ship.length, !across)
      const others = placed.filter((_, k) => k !== index).flat()
      if (!fits(cells, others)) {
        reject()
        return
      }
      sound.play('tick')
      commit(placed.map((sh, k) => (k === index ? cells : sh)))
    },
    [placed, commit, reject, sound],
  )

  const randomise = useCallback(() => {
    sound.play('pop')
    commit(regroup(makeFleet()))
  }, [commit, sound])

  const clear = useCallback(() => {
    sound.play('tap')
    commit([])
  }, [commit, sound])

  // R rotates, which is what everyone tries on a keyboard — mid-drag included.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyR' || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      setHorizontal((h) => !h)
      sound.play('tick')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sound])

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-3 sm:px-6 short:max-w-3xl short:flex-row short:items-center short:gap-6">
      <div className={`mx-auto shrink-0 ${PLACE_BOARD}`}>
        <div className="flex items-baseline justify-between pb-2">
          <span className="chrome text-muted">Place your fleet</span>
          <span className="chrome" style={{ color: done ? 'var(--t-muted)' : 'var(--t-accent)' }}>
            {done ? 'All down' : `${nextSize} long`}
          </span>
        </div>

        <motion.div
          ref={boardRef}
          animate={rejected ? { x: [0, -6, 6, -3, 0] } : { x: 0 }}
          transition={{ duration: 0.26 }}
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))`, touchAction: 'none' }}
          onPointerDown={onPointerDown}
        >
          {Array.from({ length: GRID * GRID }, (_, i) => {
            const ship = taken.includes(i)
            const run = onBoard.find((sh) => sh.includes(i))
            const ghost = previewSet.has(i)
            const tone = ghost
              ? previewOk
                ? 'var(--t-accent)'
                : 'var(--t-danger)'
              : ship
                ? 'var(--t-accent)'
                : 'var(--t-line)'
            return (
              <Press
                key={i}
                cue={null}
                depth={1}
                aria-label={ship ? `Ship at ${i + 1}, tap to lift` : `Place at ${i + 1}`}
                // Keyboard only — see `activate`. A synthesised click carries
                // detail 0; a real one always has a pointer behind it, and that
                // path has already been handled on pointerup.
                onClick={(e) => {
                  if (e.detail === 0) activate(i)
                }}
                className="relative grid aspect-square place-items-center overflow-hidden rounded-lg border"
                style={{
                  touchAction: 'none',
                  borderColor: tone,
                  backgroundColor: ghost
                    ? previewOk
                      ? 'var(--t-accent-wash)'
                      : 'var(--t-danger-wash)'
                    : ship
                      ? 'var(--t-accent)'
                      : 'var(--t-surface)',
                }}
              >
                {run ? <ShipCell cells={run} index={i} fill="var(--t-accent-ink)" /> : null}
                {/* The ship riding the thumb, drawn over whatever is beneath. */}
                {ghost && preview ? (
                  <ShipCell
                    cells={preview}
                    index={i}
                    fill={previewOk ? 'var(--t-accent)' : 'var(--t-danger)'}
                  />
                ) : null}
              </Press>
            )
          })}
        </motion.div>
      </div>

      <div className="mx-auto w-full max-w-[max(13rem,min(100%,calc(100dvh-24rem)))] short:mx-0 short:max-w-xs">
        {/* The fleet. Ships still in the tray are shown flat; ones already on
            the board get their own rotate control, so a ship can be turned
            after it is down without lifting it and placing it again — which was
            the only way to change your mind before. */}
        <div className="flex items-center gap-2 pt-4 short:pt-0">
          {SHIPS.map((size, k) => {
            const down = k < placed.length
            const current = k === placed.length
            const pips = (
              <span className="flex gap-[3px]">
                {Array.from({ length: size }, (_, c) => (
                  <span
                    key={c}
                    className="block h-3 w-3 rounded-[3px]"
                    style={{
                      backgroundColor: current
                        ? 'var(--t-accent)'
                        : down
                          ? 'var(--t-accent)'
                          : 'var(--t-line-strong)',
                    }}
                  />
                ))}
              </span>
            )

            if (!down) {
              return (
                <motion.div
                  key={k}
                  animate={{ opacity: 1, scale: current ? 1 : 0.94 }}
                  transition={spring}
                  className="flex"
                >
                  {pips}
                </motion.div>
              )
            }

            const across = placed[k][1] - placed[k][0] === 1
            return (
              <Press
                key={k}
                cue={null}
                depth={0.9}
                onPress={() => rotateAt(k)}
                aria-label={`Rotate the ${size}-cell ship, currently ${across ? 'across' : 'down'}`}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5"
              >
                {pips}
                {/* A quarter turn on the glyph itself, so the control shows the
                    ship's current lie rather than just naming the action. */}
                <motion.svg
                  viewBox="0 0 12 12"
                  animate={{ rotate: across ? 0 : 90 }}
                  transition={spring}
                  className="h-3 w-3 shrink-0"
                  aria-hidden
                >
                  <path
                    d="M2 6 h6 M6 3.4 L8.8 6 L6 8.6"
                    fill="none"
                    stroke="var(--t-muted)"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </motion.svg>
              </Press>
            )
          })}
          <span className="chrome text-muted/60 ml-auto">
            {placed.length}/{SHIPS.length}
          </span>
        </div>

        <div className="flex gap-2 pt-3">
          <Button
            variant="secondary"
            full
            onClick={() => {
              setHorizontal((h) => !h)
              sound.play('tick')
            }}
          >
            {horizontal ? 'Across' : 'Down'}
          </Button>
          <Button variant="secondary" full onClick={done ? clear : randomise}>
            {done ? 'Clear' : 'Random'}
          </Button>
        </div>

        <div className="pt-2">
          <Button full size="lg" disabled={!done} onClick={onDone}>
            Ready
          </Button>
        </div>

        <p className="pt-3 text-center text-[0.8125rem] text-muted short:hidden">
          Drag a ship into place, or tap to drop it. Tap one again to lift it.
        </p>
      </div>
    </div>
  )
}

/**
 * The silhouette of one cell of a ship: a pointed bow, a flat middle, a squared
 * stern. Drawn rather than iconified so a three-cell ship reads as one object
 * spanning three squares instead of three identical stamps in a row — which is
 * what made the old solid blocks look like nothing in particular.
 */
function ShipCell({
  cells,
  index,
  fill,
  opacity = 0.9,
}: {
  cells: number[]
  index: number
  fill: string
  opacity?: number
}) {
  const sorted = [...cells].sort((a, b) => a - b)
  const pos = sorted.indexOf(index)
  const horizontal = sorted.length > 1 && sorted[1] - sorted[0] === 1
  const bow = pos === 0
  const stern = pos === sorted.length - 1

  // One cell of hull, in a 0..10 box, then rotated for vertical ships.
  const inset = 1.6
  const d = bow
    ? `M5,0.6 L${10 - inset},${inset + 1} L${10 - inset},10 L${inset},10 L${inset},${inset + 1} Z`
    : stern
      ? `M${inset},0 L${10 - inset},0 L${10 - inset},9 Q5,10.6 ${inset},9 Z`
      : `M${inset},0 L${10 - inset},0 L${10 - inset},10 L${inset},10 Z`

  return (
    <svg
      viewBox="0 0 10 10"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ transform: horizontal ? 'rotate(-90deg)' : undefined }}
      aria-hidden
    >
      <path d={d} fill={fill} opacity={opacity} />
      {/* A single porthole marks the middle cells, so length is countable. */}
      {!bow && !stern ? <circle cx="5" cy="5" r="1.1" fill={fill} opacity={0.45} /> : null}
    </svg>
  )
}

/**
 * A hit, as eight square shards thrown outward on a spring.
 *
 * Squares rather than a smooth ring or a sprite: the whole board is squares, so
 * the debris reads as the cell itself coming apart. Deliberately short — this
 * fires on every hit, and anything longer than a third of a second would start
 * to sit between the player and their next shot.
 */
function Blast({ id }: { id: number }) {
  const shards = 8
  return (
    <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
      {Array.from({ length: shards }, (_, k) => {
        const angle = (k / shards) * Math.PI * 2
        const reach = 15 + (k % 3) * 5
        return (
          <motion.span
            key={`${id}-${k}`}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(angle) * reach,
              y: Math.sin(angle) * reach,
              opacity: 0,
              scale: 0.3,
            }}
            transition={{ duration: 0.34, ease: 'easeOut' }}
            className="absolute block"
            style={{
              width: 4,
              height: 4,
              backgroundColor: 'var(--t-accent)',
            }}
          />
        )
      })}
    </span>
  )
}

/**
 * A ship going down, cell by cell along its length.
 *
 * Where `Blast` is a single square coming apart, this has to read as one *object*
 * being destroyed — so the flash runs down the hull from bow to stern rather than
 * firing everywhere at once, and each cell drops as it goes. Staggering it is the
 * whole trick: simultaneous flashes look like three separate hits, which is
 * exactly the thing the animation exists to distinguish itself from.
 */
function SinkFlash({ id, step }: { id: number; step: number }) {
  return (
    <motion.span
      key={id}
      className="pointer-events-none absolute inset-0 rounded-lg"
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: [0, 1, 0], scale: [0.7, 1.25, 1] }}
      transition={{ duration: 0.5, delay: step * 0.07, ease: 'easeOut' }}
      style={{ backgroundColor: 'var(--t-accent)' }}
      aria-hidden
    />
  )
}

/** Three ship glyphs, struck through as each goes down. */
function FleetPips({
  down,
  alive,
  gone,
}: {
  down: boolean[]
  alive: string
  gone: string
}) {
  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      {SHIPS.map((size, k) => (
        <motion.span
          key={k}
          className="flex gap-[2px]"
          animate={{ opacity: down[k] ? 0.55 : 1 }}
          transition={spring}
        >
          {Array.from({ length: size }, (_, c) => (
            <motion.span
              key={c}
              className="block h-[5px] w-[5px] rounded-[1px]"
              animate={{ backgroundColor: down[k] ? gone : alive }}
              transition={spring}
            />
          ))}
        </motion.span>
      ))}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Firing                                                                      */
/* -------------------------------------------------------------------------- */

function FiringBoard({
  state,
  slot,
  theirSlot,
  fleet,
  ships,
  myTurn,
  waiting,
  send,
  sound,
}: {
  state: SalvoState
  slot: 'host' | 'guest'
  theirSlot: 'host' | 'guest'
  fleet: number[]
  ships: number[][]
  myTurn: boolean
  waiting: boolean
  send: (type: string, data?: unknown) => void
  sound: Sound
}) {
  const boardRef = useRef<HTMLDivElement>(null)
  useGridKeys(boardRef, GRID, myTurn)

  const myShots = state.shots[slot]
  const theirShots = state.shots[theirSlot]

  /* -- what has gone down, on both boards ----------------------------------- */

  // Their ships I have sunk: each sunk cell mapped to the vessel it belonged to,
  // so a wreck can be drawn as one hull rather than as loose hit markers.
  const wrecks = useMemo(() => {
    const out = new Map<number, { cells: number[]; step: number; id: number }>()
    myShots.forEach((m, order) => {
      if (!m.sunk) return
      m.sunk.forEach((c, step) => out.set(c, { cells: m.sunk!, step, id: order }))
    })
    return out
  }, [myShots])

  const sunkSizes = useMemo(
    () => myShots.flatMap((m) => (m.sunk ? [m.sunk.length] : [])),
    [myShots],
  )

  // My own losses. I know my fleet, so this needs nothing extra over the wire.
  const struckOnMe = useMemo(
    () => new Set(theirShots.filter((s) => s.hit).map((s) => s.i)),
    [theirShots],
  )
  const lostShips = useMemo(
    () => ships.filter((sh) => sh.every((c) => struckOnMe.has(c))),
    [ships, struckOnMe],
  )
  const lostCells = useMemo(() => new Set(lostShips.flat()), [lostShips])

  /* -- announcements -------------------------------------------------------- */

  const [blast, setBlast] = useState<{ i: number; n: number } | null>(null)
  const [note, setNote] = useState<{ n: number; text: string; mine: boolean } | null>(null)
  const noteId = useRef(0)

  const announce = useCallback((text: string, mine: boolean) => {
    setNote({ n: noteId.current++, text, mine })
  }, [])

  // Cue and flourish on the frame a result *lands*, never on a re-render. Both
  // counters start from whatever is already in the log, so rejoining a match in
  // progress does not replay every sinking that happened while we were away.
  const seenMine = useRef<number | null>(null)
  useEffect(() => {
    const n = myShots.length
    if (seenMine.current === null) {
      seenMine.current = n
      return
    }
    if (n > seenMine.current) {
      const last = myShots[n - 1]
      if (last.hit) setBlast({ i: last.i, n })
      if (last.sunk) {
        sound.play('sink')
        announce(`Sunk their ${last.sunk.length}`, true)
      } else {
        sound.play(last.hit ? 'pop' : 'tick')
      }
    }
    seenMine.current = n
  }, [myShots, sound, announce])

  const seenTheirs = useRef<number | null>(null)
  useEffect(() => {
    const n = theirShots.length
    if (seenTheirs.current === null) {
      seenTheirs.current = n
      return
    }
    if (n > seenTheirs.current) {
      const last = theirShots[n - 1]
      if (last.sunk) {
        sound.play('sink')
        announce(`They sank your ${last.sunk.length}`, false)
      }
    }
    seenTheirs.current = n
  }, [theirShots, sound, announce])

  // The banner is a moment, not a state — clear it on a timer rather than
  // leaving the last sinking pinned over the board for the rest of the game.
  useEffect(() => {
    if (!note) return
    const id = setTimeout(() => setNote((cur) => (cur && cur.n === note.n ? null : cur)), 1_900)
    return () => clearTimeout(id)
  }, [note])

  // The cell we have just fired at, held until the answer lands. Without it the
  // board sits inert for the half-second the defender takes to reply and the tap
  // reads as dropped.
  const inFlight = state.pending?.by === slot ? state.pending.i : null

  const status = waiting
    ? 'Waiting for them'
    : state.pending
      ? state.pending.by === slot
        ? 'Incoming…'
        : 'They fired'
      : myTurn
        ? 'Your shot'
        : 'Their shot'

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-3 sm:px-6">
      <div className="relative mx-auto w-full" style={{ maxWidth: BOARD_CAP }}>
        {/* A sinking is the one event in Salvo worth stopping to read, so it is
            said in words as well as drawn — a hit and a kill otherwise look the
            same at a glance on a board this small. */}
        <AnimatePresence>
          {note ? (
            <motion.div
              key={note.n}
              initial={{ opacity: 0, y: -10, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={springSoft}
              className="pointer-events-none absolute inset-x-0 top-8 z-10 flex justify-center"
              role="status"
            >
              <span
                className="chrome rounded-full border px-3.5 py-1.5"
                style={{
                  color: note.mine ? 'var(--t-accent-ink)' : 'var(--t-danger-ink)',
                  backgroundColor: note.mine ? 'var(--t-accent)' : 'var(--t-danger)',
                  borderColor: note.mine ? 'var(--t-accent)' : 'var(--t-danger)',
                }}
              >
                {note.text}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex items-baseline justify-between pb-2">
          <span className="flex items-center gap-2">
            <span className="chrome text-muted">Their waters</span>
            <FleetPips
              down={markOffSizes(sunkSizes)}
              alive="var(--t-line-strong)"
              gone="var(--t-accent)"
            />
          </span>
          <span className="chrome" style={{ color: myTurn ? 'var(--t-accent)' : 'var(--t-muted)' }}>
            {status}
          </span>
        </div>

        {/* The board you shoot at. */}
        <div
          ref={boardRef}
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: GRID * GRID }, (_, i) => {
            const mark = myShots.find((s) => s.i === i)
            const wreck = wrecks.get(i)
            const pendingHere = inFlight === i
            const playable = myTurn && !alreadyShot(state, slot, i)
            return (
              <Press
                key={i}
                cue={null}
                depth={playable ? 0.9 : 1}
                disabled={!playable}
                aria-label={
                  wreck
                    ? `Sunk ship at ${i + 1}`
                    : mark
                      ? mark.hit
                        ? `Hit at ${i + 1}`
                        : `Miss at ${i + 1}`
                      : `Fire at ${i + 1}`
                }
                onPress={() => {
                  if (!playable) return
                  sound.play('tap')
                  send(EV_SHOT, { i })
                }}
                className="relative grid aspect-square place-items-center overflow-hidden rounded-lg border disabled:pointer-events-none"
                style={{
                  borderColor: mark?.hit || pendingHere ? 'var(--t-accent)' : 'var(--t-line)',
                  // A sunk ship fills solid where a live hit is only washed, so
                  // a finished vessel reads as one dark shape across its cells.
                  backgroundColor: wreck
                    ? 'var(--t-accent)'
                    : mark?.hit
                      ? 'var(--t-accent-wash)'
                      : 'var(--t-surface)',
                }}
              >
                {/* In-flight: a pulse where the shot is going, replaced the
                    instant the real answer arrives. */}
                {pendingHere && !mark ? (
                  <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: [0.7, 1, 0.7], opacity: 1 }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
                    className="block rounded-full"
                    style={{ width: '38%', height: '38%', backgroundColor: 'var(--t-accent)' }}
                  />
                ) : null}

                {blast && blast.i === i ? <Blast key={blast.n} id={blast.n} /> : null}
                {wreck ? <SinkFlash id={wreck.id} step={wreck.step} /> : null}

                <AnimatePresence>
                  {wreck ? (
                    // The wreck itself: the hull, drawn across the cells it
                    // occupied, so what you destroyed is visible as a ship.
                    <ShipCell
                      cells={wreck.cells}
                      index={i}
                      fill="var(--t-accent-ink)"
                      opacity={0.85}
                    />
                  ) : mark ? (
                    <motion.span
                      initial={{ scale: 0.3, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={springSoft}
                      className="block rounded-full"
                      style={
                        mark.hit
                          ? { width: '52%', height: '52%', backgroundColor: 'var(--t-accent)' }
                          : { width: '22%', height: '22%', backgroundColor: 'var(--t-muted)' }
                      }
                    />
                  ) : null}
                </AnimatePresence>
              </Press>
            )
          })}
        </div>

        <div className="mt-1 flex items-baseline justify-between pt-4 pb-2">
          <span className="flex items-center gap-2">
            <span className="chrome text-muted">Your fleet</span>
            <FleetPips
              down={markOffSizes(lostShips.map((sh) => sh.length))}
              alive="var(--t-ink)"
              gone="var(--t-danger)"
            />
          </span>
        </div>

        {/* Your own board, at a glance: your ships plus where they have fired. */}
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))`, maxWidth: '13rem' }}
        >
          {Array.from({ length: GRID * GRID }, (_, i) => {
            const ship = fleet.includes(i)
            const incoming = theirShots.find((s) => s.i === i)
            const lost = lostCells.has(i)
            return (
              <motion.span
                key={i}
                animate={{
                  backgroundColor: incoming?.hit
                    ? 'var(--t-danger)'
                    : ship
                      ? 'var(--t-ink)'
                      : incoming
                        ? 'var(--t-line-strong)'
                        : 'var(--t-line)',
                }}
                transition={spring}
                className="relative aspect-square rounded-[3px]"
              >
                {/* A struck ship of yours is a loss, so it reads red rather
                    than in whatever accent happens to be set — and once the
                    whole vessel is gone the cell fills, so a sinking is legible
                    here too rather than only in the banner. */}
                {incoming?.hit ? (
                  <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={springSnap}
                    className={`absolute rounded-[1px] ${lost ? 'inset-[14%]' : 'inset-[26%]'}`}
                    style={{ backgroundColor: 'var(--t-danger-ink)' }}
                  />
                ) : null}
              </motion.span>
            )
          })}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={myTurn ? 'go' : 'wait'}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={springSnap}
            className="pt-4 text-center text-[0.8125rem] text-muted short:hidden"
          >
            Three ships each. A hit earns another shot.
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  )
}
