import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { Counter } from '../../components/Counter'
import { Press } from '../../components/Press'
import { useGridKeys } from '../../lib/input'
import { spring, springSnap, springSoft } from '../../lib/motion'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import { BOMB, EV_BANK, EV_FLIP, TARGET, TILES, bombOdds, gridFor } from './logic'
import type { NerveState } from './logic'

export function NerveView({ state, ctx, send }: GameViewProps<NerveState>) {
  const { slot, seed } = ctx
  const sound = useSound()
  const myTurn = state.turn === slot && state.phase === 'playing'
  const grid = gridFor(seed, state.turnIndex)
  const odds = Math.round(bombOdds(state) * 100)

  // One bang per bust, not one per render.
  const bustedAt = useRef(-1)
  useEffect(() => {
    if (!state.busted) return
    if (bustedAt.current === state.turnIndex) return
    bustedAt.current = state.turnIndex
    sound.play('foul')
  }, [state.busted, state.turnIndex, sound])

  const boardRef = useRef<HTMLDivElement>(null)
  useGridKeys(boardRef, 4, myTurn)

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-3 sm:px-6">
      {/* The pot is the whole tension of the game, so it is the loud element. */}
      <div className="flex items-end justify-between pb-3">
        <div className="flex flex-col gap-1">
          <span className="chrome text-muted">In the pot</span>
          <motion.span
            animate={{ color: state.pot > 0 ? 'var(--t-accent)' : 'var(--t-muted)' }}
            transition={spring}
            className="display text-[2.75rem] leading-none sm:text-[3.25rem]"
          >
            <Counter value={state.pot} />
          </motion.span>
        </div>

        <div className="flex flex-col items-end gap-1 pb-1">
          <span className="chrome text-muted">Bomb risk</span>
          <span className="chrome tnum" style={{ color: odds >= 30 ? 'var(--t-accent)' : undefined }}>
            {odds}%
          </span>
        </div>
      </div>

      <div
        ref={boardRef}
        className="grid grid-cols-4 gap-2"
        style={{ maxWidth: 'min(100%, calc(100dvh - 19rem))' }}
      >
        {Array.from({ length: TILES }, (_, i) => {
          const isOpen = state.revealed.includes(i)
          const value = grid[i]
          const isBomb = isOpen && value === BOMB

          return (
            <Press
              key={`${state.turnIndex}-${i}`}
              cue={null}
              depth={myTurn && !isOpen ? 0.9 : 1}
              disabled={!myTurn || isOpen}
              aria-label={isOpen ? (isBomb ? 'Bomb' : `${value} points`) : `Tile ${i + 1}`}
              onPress={() => {
                if (!myTurn || isOpen) return
                sound.play('pop')
                send(EV_FLIP, { i })
              }}
              className="relative grid aspect-square place-items-center rounded-xl border disabled:pointer-events-none"
              style={{
                // The bomb is red in every theme and under every accent. It is
                // the one tile that costs you everything, so it must never take
                // on a colour the player chose because they liked it.
                borderColor: isBomb ? 'var(--t-danger)' : 'var(--t-line)',
                backgroundColor: isBomb
                  ? 'var(--t-danger-wash)'
                  : isOpen
                    ? 'transparent'
                    : 'var(--t-surface)',
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isOpen ? (
                  <motion.span
                    key="face"
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={springSoft}
                    className="display text-[1.375rem]"
                    style={{ color: isBomb ? 'var(--t-accent)' : 'var(--t-muted)' }}
                  >
                    {isBomb ? '✕' : value}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </Press>
          )
        })}
      </div>

      <div className="safe-b mt-4">
        <AnimatePresence mode="wait" initial={false}>
          {state.busted && !myTurn ? (
            <motion.p
              key="bust"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={springSnap}
              className="chrome pb-3 text-center text-accent"
            >
              Bomb — pot lost
            </motion.p>
          ) : (
            <motion.p
              key="turn"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={springSnap}
              className="chrome pb-3 text-center text-muted"
            >
              {myTurn ? 'Flip a tile, or bank what you have' : 'Their turn'}
            </motion.p>
          )}
        </AnimatePresence>

        <Press
          cue="confirm"
          onClick={() => {
            if (!myTurn) return
            send(EV_BANK)
          }}
          disabled={!myTurn || state.pot === 0}
          className="h-15 w-full rounded-xl bg-accent text-accent-ink disabled:opacity-30"
        >
          <span className="chrome">Bank {state.pot > 0 ? state.pot : ''}</span>
        </Press>

        <p className="pt-2.5 text-center text-[0.75rem] text-muted short:hidden">
          First to {TARGET} banked. A bomb takes everything you haven't banked.
        </p>
      </div>
    </div>
  )
}
