import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  HITS_TO_WIN,
  SHIPS,
  alreadyShot,
  bothReady,
  defenderOf,
  fits,
  loadFleet,
  makeFleet,
  saveFleet,
  shipCells,
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
  const live = bothReady(state)

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

  const myTurn = state.turn === slot && !state.pending && state.phase === 'playing' && live

  // Answer any shot aimed at us. Only this client knows where its ships are, so
  // only this client can say whether it was a hit.
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

    const hit = fleet.includes(state.pending.i)
    const id = setTimeout(() => send(EV_RESULT, { i: state.pending!.i, hit }), 260)
    return () => clearTimeout(id)
  }, [state, settled, slot, fleet, send])

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

/**
 * Tap a cell to drop the next ship there. There is no drag: dragging a
 * three-cell ship around a 6x6 grid with a thumb over it is fiddly, and tapping
 * gives the same result in one gesture. Tapping a placed ship picks it up again.
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

  const boardRef = useRef<HTMLDivElement>(null)
  useGridKeys(boardRef, GRID, true)

  const taken = useMemo(() => placed.flat(), [placed])
  const nextSize = SHIPS[placed.length]
  const done = placed.length === SHIPS.length

  const commit = useCallback(
    (ships: number[][]) => {
      setPlaced(ships)
      onChange(ships.flat().sort((a, b) => a - b))
    },
    [onChange],
  )

  const tap = useCallback(
    (i: number) => {
      // Lifting: tapping any cell of a placed ship returns it to the tray.
      const hit = placed.findIndex((ship) => ship.includes(i))
      if (hit >= 0) {
        sound.play('tap')
        commit(placed.filter((_, k) => k !== hit))
        return
      }
      if (done) return

      const cells = shipCells(i, nextSize, horizontal)
      if (!fits(cells, taken)) {
        sound.play('foul')
        setRejected(true)
        setTimeout(() => setRejected(false), 260)
        return
      }
      sound.play('pop')
      commit([...placed, cells])
    },
    [placed, done, nextSize, horizontal, taken, commit, sound],
  )

  const randomise = useCallback(() => {
    sound.play('pop')
    const flat = makeFleet()
    commit(regroup(flat))
  }, [commit, sound])

  const clear = useCallback(() => {
    sound.play('tap')
    commit([])
  }, [commit, sound])

  // R rotates, which is what everyone tries on a keyboard.
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
          style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: GRID * GRID }, (_, i) => {
            const ship = taken.includes(i)
            const run = placed.find((sh) => sh.includes(i))
            return (
              <Press
                key={i}
                cue={null}
                depth={0.9}
                aria-label={ship ? `Ship at ${i + 1}, tap to lift` : `Place at ${i + 1}`}
                // Deliberately click, not onPress. Something in the motion
                // wrapper on this particular grid swallows Enter before the
                // keydown handler sees it, and losing keyboard placement is a
                // worse regression than a tap's worth of delay on a surface you
                // touch three times a game. The firing board, where speed
                // actually matters, uses onPress.
                onClick={() => tap(i)}
                className="relative grid aspect-square place-items-center overflow-hidden rounded-lg border"
                style={{
                  borderColor: ship ? 'var(--t-accent)' : 'var(--t-line)',
                  backgroundColor: ship ? 'var(--t-accent)' : 'var(--t-surface)',
                }}
              >
                {run ? <ShipCell cells={run} index={i} /> : null}
              </Press>
            )
          })}
        </motion.div>
      </div>

      <div className="mx-auto w-full max-w-[max(13rem,min(100%,calc(100dvh-24rem)))] short:mx-0 short:max-w-xs">
        {/* Which ships are still in the tray. */}
        <div className="flex items-center gap-1.5 pt-4 short:pt-0">
          {SHIPS.map((size, k) => {
            const down = k < placed.length
            const current = k === placed.length
            return (
              <motion.div
                key={k}
                animate={{ opacity: down ? 0.28 : 1, scale: current ? 1 : 0.94 }}
                transition={spring}
                className="flex gap-[3px]"
              >
                {Array.from({ length: size }, (_, c) => (
                  <span
                    key={c}
                    className="block h-3 w-3 rounded-[3px]"
                    style={{
                      backgroundColor: current ? 'var(--t-accent)' : 'var(--t-line-strong)',
                    }}
                  />
                ))}
              </motion.div>
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
          Tap to drop a ship, tap it again to lift it.
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
function ShipCell({ cells, index }: { cells: number[]; index: number }) {
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
      className="absolute inset-0 h-full w-full"
      style={{ transform: horizontal ? 'rotate(-90deg)' : undefined }}
      aria-hidden
    >
      <path d={d} fill="var(--t-accent-ink)" opacity="0.9" />
      {/* A single porthole marks the middle cells, so length is countable. */}
      {!bow && !stern ? (
        <circle cx="5" cy="5" r="1.1" fill="var(--t-accent)" opacity="0.75" />
      ) : null}
    </svg>
  )
}

/** Every in-bounds straight run of `size` starting at `start`. */
function runsAt(start: number, size: number): number[][] {
  const x = start % GRID
  const y = Math.floor(start / GRID)
  const out: number[][] = []

  if (x + size <= GRID) {
    out.push(Array.from({ length: size }, (_, k) => start + k))
  }
  if (y + size <= GRID) {
    out.push(Array.from({ length: size }, (_, k) => start + k * GRID))
  }
  return out
}

/**
 * Split a flat fleet back into its ships, so one can be lifted without
 * disturbing the others — needed after a refresh and after Random, where all we
 * have is the set of occupied cells.
 *
 * This backtracks rather than matching greedily. Two ships can sit end to end in
 * the same row, and a greedy pass would take the first three of those four cells
 * as the long ship and then fail to place the rest — leaving the board full but
 * the tray non-empty, which is unrecoverable from the UI. The space is three
 * ships over 36 cells, so an exhaustive search is instant and always right.
 */
function regroup(flat: number[]): number[][] {
  const remaining = new Set(flat)
  if (remaining.size !== HITS_TO_WIN) return []

  const solve = (index: number, pool: Set<number>): number[][] | null => {
    if (index === SHIPS.length) return pool.size === 0 ? [] : null

    const size = SHIPS[index]
    for (const start of [...pool].sort((a, b) => a - b)) {
      for (const run of runsAt(start, size)) {
        if (!run.every((c) => pool.has(c))) continue
        const next = new Set(pool)
        run.forEach((c) => next.delete(c))
        const rest = solve(index + 1, next)
        if (rest) return [run, ...rest]
      }
    }
    return null
  }

  return solve(0, remaining) ?? []
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

/* -------------------------------------------------------------------------- */
/* Firing                                                                      */
/* -------------------------------------------------------------------------- */

function FiringBoard({
  state,
  slot,
  theirSlot,
  fleet,
  myTurn,
  waiting,
  send,
  sound,
}: {
  state: SalvoState
  slot: 'host' | 'guest'
  theirSlot: 'host' | 'guest'
  fleet: number[]
  myTurn: boolean
  waiting: boolean
  send: (type: string, data?: unknown) => void
  sound: Sound
}) {
  const boardRef = useRef<HTMLDivElement>(null)
  useGridKeys(boardRef, GRID, myTurn)

  const myShots = state.shots[slot]
  const theirShots = state.shots[theirSlot]
  const myHits = myShots.filter((s) => s.hit).length

  // Blast only on the frame a hit is *added*, never on every re-render.
  const [blast, setBlast] = useState<{ i: number; n: number } | null>(null)
  const seenHits = useRef(0)
  useEffect(() => {
    const hits = myShots.filter((s) => s.hit)
    if (hits.length > seenHits.current) {
      const last = hits[hits.length - 1]
      setBlast({ i: last.i, n: hits.length })
    }
    seenHits.current = hits.length
  }, [myShots])

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
      <div className="mx-auto w-full" style={{ maxWidth: BOARD_CAP }}>
        <div className="flex items-baseline justify-between pb-2">
          <span className="chrome text-muted">Their waters</span>
          <span
            className="chrome"
            style={{ color: myTurn ? 'var(--t-accent)' : 'var(--t-muted)' }}
          >
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
            const pendingHere = inFlight === i
            const playable = myTurn && !alreadyShot(state, slot, i)
            return (
              <Press
                key={i}
                cue={null}
                depth={playable ? 0.9 : 1}
                disabled={!playable}
                aria-label={
                  mark ? (mark.hit ? `Hit at ${i + 1}` : `Miss at ${i + 1}`) : `Fire at ${i + 1}`
                }
                onPress={() => {
                  if (!playable) return
                  sound.play('tap')
                  send(EV_SHOT, { i })
                }}
                className="relative grid aspect-square place-items-center rounded-lg border disabled:pointer-events-none"
                style={{
                  borderColor: mark?.hit
                    ? 'var(--t-accent)'
                    : pendingHere
                      ? 'var(--t-accent)'
                      : 'var(--t-line)',
                  backgroundColor: mark?.hit ? 'var(--t-accent-wash)' : 'var(--t-surface)',
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

                <AnimatePresence>
                  {mark ? (
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
          <span className="chrome text-muted">Your fleet</span>
          <span className="chrome tnum text-muted/70">
            {myHits} / {HITS_TO_WIN} sunk
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
                    than in whatever accent happens to be set. */}
                {incoming?.hit ? (
                  <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={springSnap}
                    className="absolute inset-[26%] rounded-[1px]"
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
