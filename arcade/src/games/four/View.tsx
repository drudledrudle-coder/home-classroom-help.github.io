import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import type { Slot } from '../../../shared/protocol'
import { Press } from '../../components/Press'
import { spring, springSnap } from '../../lib/motion'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import { COLS, EV_DROP, EV_NEXT, ROWS, at, landingRow } from './logic'
import type { FourState } from './logic'

const ROUND_HOLD_MS = 1_800

export function FourView({ state, ctx, send }: GameViewProps<FourState>) {
  const { slot } = ctx
  const sound = useSound()
  const myTurn = state.turn === slot && !state.roundOver && state.phase === 'playing'

  // Host owns the round reset, so exactly one client writes it.
  useEffect(() => {
    if (slot !== 'host' || !state.roundOver || state.phase === 'over') return
    const id = setTimeout(() => send(EV_NEXT), ROUND_HOLD_MS)
    return () => clearTimeout(id)
  }, [slot, state.roundOver, state.phase, send])

  const label = state.roundOver
    ? state.roundWinner === 'tie'
      ? 'Full board — reset'
      : state.roundWinner === slot
        ? 'Round yours'
        : 'Round theirs'
    : myTurn
      ? 'Your turn'
      : 'Their turn'

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-3 py-3 sm:px-6">
      <div className="flex h-6 items-center justify-center gap-2">
        <motion.span
          animate={{
            backgroundColor: myTurn || state.roundOver ? 'var(--t-accent)' : 'var(--t-line-strong)',
            scale: myTurn ? 1 : 0.7,
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

      {/* Columns rather than cells: the whole column is the target, which is
          far easier to hit with a thumb than a single disc. */}
      <div
        className="mt-3 grid w-full gap-1 rounded-2xl border border-line bg-surface p-1.5 sm:gap-1.5 sm:p-2"
        style={{
          gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
          maxWidth: 'min(100%, calc((100dvh - 15rem) * 1.16))',
        }}
      >
        {Array.from({ length: COLS }, (_, col) => {
          const playable = myTurn && landingRow(state.board, col) >= 0
          return (
            <Press
              key={col}
              cue={null}
              depth={playable ? 0.96 : 1}
              disabled={!playable}
              aria-label={`Column ${col + 1}`}
              onClick={() => {
                if (!playable) return
                sound.play('pop')
                send(EV_DROP, { col })
              }}
              className="flex flex-col gap-1 rounded-lg disabled:pointer-events-none sm:gap-1.5"
            >
              {Array.from({ length: ROWS }, (_, row) => {
                const owner = state.board[at(row, col)]
                const inLine = state.line?.includes(at(row, col)) ?? false
                return (
                  <span
                    key={row}
                    className="relative grid aspect-square w-full place-items-center rounded-full"
                    style={{ backgroundColor: 'var(--t-bg)' }}
                  >
                    <AnimatePresence>
                      {owner ? (
                        <motion.span
                          // Falls in from above, which is the whole feel of the game.
                          initial={{ y: -18 * (row + 1), opacity: 0.4 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 520, damping: 26, mass: 0.7 }}
                          className="absolute inset-[9%] rounded-full"
                          style={{
                            backgroundColor:
                              owner === slot ? 'var(--t-accent)' : 'var(--t-ink)',
                            outline: inLine ? '2px solid var(--t-accent)' : undefined,
                            outlineOffset: '2px',
                          }}
                        />
                      ) : null}
                    </AnimatePresence>
                  </span>
                )
              })}
            </Press>
          )
        })}
      </div>

      <p className="pt-3 text-center text-[0.8125rem] text-muted short:hidden">
        Four in a row, any direction. Tap a column to drop.
      </p>
    </div>
  )
}

export type { Slot }
