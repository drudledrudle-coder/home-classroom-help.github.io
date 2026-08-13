import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { OTHER } from '../../../shared/protocol'
import { Press } from '../../components/Press'
import { spring, springSnap, springSoft } from '../../lib/motion'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import {
  EV_RESULT,
  EV_SHOT,
  GRID,
  HITS_TO_WIN,
  alreadyShot,
  defenderOf,
  fleetFor,
} from './logic'
import type { SalvoState } from './logic'

export function SalvoView({ state, ctx, send }: GameViewProps<SalvoState>) {
  const { slot } = ctx
  const sound = useSound()
  const theirSlot = OTHER[slot]

  // This client's fleet, cached per match so a refresh keeps the same ships.
  const fleet = useMemo(
    () => fleetFor('room', 0, ctx.startedAt),
    [ctx.startedAt],
  )

  const myTurn = state.turn === slot && !state.pending && state.phase === 'playing'

  // Answer any shot aimed at us. Only this client knows where its ships are, so
  // only this client can say whether it was a hit.
  const answeredFor = useRef(-1)
  useEffect(() => {
    if (state.phase === 'over') return
    if (defenderOf(state) !== slot || !state.pending) return
    if (answeredFor.current === state.pending.i) return
    answeredFor.current = state.pending.i

    const hit = fleet.includes(state.pending.i)
    const id = setTimeout(() => send(EV_RESULT, { i: state.pending!.i, hit }), 260)
    return () => clearTimeout(id)
  }, [state, slot, fleet, send])

  const myShots = state.shots[slot]
  const theirShots = state.shots[theirSlot]
  const myHits = myShots.filter((s) => s.hit).length

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-3 sm:px-6">
      <div className="flex items-baseline justify-between pb-2">
        <span className="chrome text-muted">Their waters</span>
        <span className="chrome" style={{ color: myTurn ? 'var(--t-accent)' : 'var(--t-muted)' }}>
          {state.pending
            ? state.pending.by === slot
              ? 'Waiting…'
              : 'They fired'
            : myTurn
              ? 'Your shot'
              : 'Their shot'}
        </span>
      </div>

      {/* The board you shoot at. */}
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))`,
          maxWidth: 'min(100%, calc(100dvh - 22rem))',
        }}
      >
        {Array.from({ length: GRID * GRID }, (_, i) => {
          const mark = myShots.find((s) => s.i === i)
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
              onClick={() => {
                if (!playable) return
                sound.play('tap')
                send(EV_SHOT, { i })
              }}
              className="relative grid aspect-square place-items-center rounded-lg border disabled:pointer-events-none"
              style={{
                borderColor: mark?.hit ? 'var(--t-accent)' : 'var(--t-line)',
                backgroundColor: mark?.hit ? 'var(--t-accent-wash)' : 'var(--t-surface)',
              }}
            >
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
                  ? 'var(--t-accent)'
                  : ship
                    ? 'var(--t-ink)'
                    : incoming
                      ? 'var(--t-line-strong)'
                      : 'var(--t-line)',
              }}
              transition={spring}
              className="aspect-square rounded-[3px]"
            />
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
  )
}
