import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { Slot } from '../../../shared/protocol'
import { Press } from '../../components/Press'
import { useGridKeys } from '../../lib/input'
import { spring, springSnap, springSoft } from '../../lib/motion'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import { EV_NEXT, EV_PLACE, canPlace, doomedCell } from './logic'
import type { ShiftState } from './logic'

/** How long the winning line stays up before the board clears. */
const ROUND_HOLD_MS = 1_700

export function ShiftView({ state, ctx, send }: GameViewProps<ShiftState>) {
  const { slot } = ctx
  const sound = useSound()
  const myTurn = state.turn === slot && !state.roundOver && state.phase === 'playing'
  const doomed = doomedCell(state, state.turn)

  // The host owns the round reset so exactly one client writes it — in solo
  // play the human is the host, so the same path covers both modes.
  useEffect(() => {
    if (slot !== 'host' || !state.roundOver || state.phase === 'over') return
    const id = setTimeout(() => send(EV_NEXT), ROUND_HOLD_MS)
    return () => clearTimeout(id)
  }, [slot, state.roundOver, state.phase, send])

  const boardRef = useRef<HTMLDivElement>(null)
  useGridKeys(boardRef, 3, myTurn)

  return (
    <div className="mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col items-center justify-center px-4 py-3 sm:px-6 sm:py-4">
      <TurnLine state={state} slot={slot} />

      {/* The board is square, so on a short screen its height is what runs out
          first — width alone would render it 512px tall inside 230px of space
          and clip it. Bounding the width by the leftover viewport height keeps
          it whole in landscape. */}
      <div
        ref={boardRef}
        className="mt-3 grid aspect-square w-full grid-cols-3 gap-2 sm:mt-4 sm:gap-2.5"
        style={{ maxWidth: 'min(100%, calc(100dvh - 11rem))' }}
      >
        {state.board.map((owner, cell) => {
          const playable = myTurn && owner === null
          const inLine = state.line?.includes(cell) ?? false
          const willVanish = doomed === cell && !state.roundOver

          return (
            <Press
              key={cell}
              cue={null}
              depth={playable ? 0.93 : 1}
              disabled={!playable}
              aria-label={`Cell ${cell + 1}${owner ? ` taken by ${owner === slot ? 'you' : 'them'}` : ''}`}
              onClick={() => {
                if (!canPlace(state, slot, cell)) return
                sound.play('pop')
                send(EV_PLACE, { cell })
              }}
              className="relative grid place-items-center rounded-2xl border disabled:pointer-events-none"
              style={{
                borderColor: inLine ? 'var(--t-accent)' : 'var(--t-line)',
                backgroundColor: inLine ? 'var(--t-accent-wash)' : 'var(--t-surface)',
              }}
            >
              <AnimatePresence mode="popLayout">
                {owner ? (
                  <motion.span
                    key={`${cell}-${owner}-${state.queues[owner].indexOf(cell)}`}
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={{
                      scale: 1,
                      opacity: willVanish ? 0.32 : 1,
                    }}
                    // Evicted pieces shrink away rather than blinking out, so
                    // it always reads as "that one left" and not a glitch.
                    exit={{ scale: 0.35, opacity: 0, transition: springSnap }}
                    transition={springSoft}
                    className="block"
                  >
                    <Mark owner={owner} mine={owner === slot} />
                  </motion.span>
                ) : null}
              </AnimatePresence>

              {willVanish ? (
                <motion.span
                  layoutId="doomed"
                  transition={spring}
                  className="pointer-events-none absolute inset-1.5 rounded-xl border border-dashed"
                  style={{ borderColor: 'var(--t-line-strong)' }}
                />
              ) : null}
            </Press>
          )
        })}
      </div>

      <p className="mt-4 text-center text-[0.8125rem] text-muted short:hidden">
        Three pieces each — your fourth pushes out your oldest.
      </p>
    </div>
  )
}

/**
 * Shape encodes which side a piece belongs to, colour encodes whether it is
 * yours. Both cues are present so the board still reads without colour.
 */
function Mark({ owner, mine }: { owner: Slot; mine: boolean }) {
  const color = mine ? 'var(--t-accent)' : 'var(--t-ink)'
  return owner === 'host' ? (
    <span
      className="block h-[clamp(2rem,11vw,3.25rem)] w-[clamp(2rem,11vw,3.25rem)] rounded-full"
      style={{ backgroundColor: color }}
    />
  ) : (
    <span
      className="block h-[clamp(2rem,11vw,3.25rem)] w-[clamp(2rem,11vw,3.25rem)] rounded-full border-[0.3rem]"
      style={{ borderColor: color }}
    />
  )
}

function TurnLine({ state, slot }: { state: ShiftState; slot: Slot }) {
  const label = state.roundOver
    ? state.roundWinner === slot
      ? 'Round yours'
      : 'Round theirs'
    : state.turn === slot
      ? 'Your move'
      : 'Their move'

  return (
    <div className="flex h-6 items-center justify-center gap-2">
      <motion.span
        animate={{
          backgroundColor:
            state.turn === slot || state.roundOver ? 'var(--t-accent)' : 'var(--t-line-strong)',
          scale: state.turn === slot && !state.roundOver ? 1 : 0.7,
        }}
        transition={spring}
        className="block h-1.5 w-1.5 rounded-full"
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={springSnap}
          className="chrome text-muted"
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
