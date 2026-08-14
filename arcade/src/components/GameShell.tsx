import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { OTHER } from '../../shared/protocol'
import type { AnyGameModule } from '../games/types'
import { spring, springScreen, springSoft } from '../lib/motion'
import { useSound } from '../lib/sound'
import type { MatchApi } from '../net/useMatch'
import { Button } from './Button'
import { Countdown } from './Countdown'
import { Counter } from './Counter'
import { TimerBar } from './TimerBar'

/**
 * Everything every game needs and no game should own: the score line, the
 * countdown, the opponent-dropped overlay and the result card. A game module
 * contributes a reducer and a board; this decides what wraps them.
 */
export function GameShell({
  match,
  module,
  onExit,
}: {
  match: MatchApi
  module: AnyGameModule
  onExit: () => void
}) {
  const { state, ctx, clock, slot, isBot, opponentPresent } = match
  const sound = useSound()
  const theirSlot = OTHER[slot]
  const opponentLabel = isBot ? 'Bot' : 'Them'

  // Re-render while the count runs so the board unlocks on the same frame the
  // overlay clears. `Countdown` animates itself; this only tracks the gate.
  const [counting, setCounting] = useState(() => clock.countdown() > 0)
  useEffect(() => {
    if (!counting) return
    let raf = 0
    const tick = () => {
      if (clock.countdown() <= 0) return setCounting(false)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [counting, clock])

  // A rematch restarts the clock, so the gate has to close again.
  useEffect(() => {
    if (clock.countdown() > 0) setCounting(true)
  }, [ctx.startedAt, clock])

  const over = state?.phase === 'over'
  const youWon = over && state?.winner === slot
  const tied = over && state?.winner === 'tie'

  // One cue per completed match, not per re-render.
  const scoredFor = useRef<number>(-1)
  useEffect(() => {
    if (!over || scoredFor.current === ctx.startedAt) return
    scoredFor.current = ctx.startedAt
    sound.play(tied ? 'pop' : youWon ? 'win' : 'lose')
  }, [over, tied, youWon, ctx.startedAt, sound])

  if (!state) return null

  const mine = state.scores[slot]
  const theirs = state.scores[theirSlot]
  const duration = module.meta.durationMs
  const View = module.View

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Score line. Deliberately small and tracked-out so the board reads as
          the loud element on the screen. */}
      <div className="mx-auto w-full max-w-3xl px-4 pt-3 sm:px-6 short:pt-1">
        <div className="flex items-end justify-between gap-4">
          <ScoreCell label="You" value={mine} leading={mine > theirs} align="left" />

          <div className="flex flex-1 flex-col items-center gap-1.5 pb-1">
            <span className="chrome text-muted/70">{module.meta.format}</span>
            {duration ? (
              <div className="w-full max-w-40">
                <TimerBar clock={clock} durationMs={duration} running={!over} />
              </div>
            ) : null}
          </div>

          <ScoreCell label={opponentLabel} value={theirs} leading={theirs > mine} align="right" />
        </div>
      </div>

      {/* The board scrolls, the chrome does not. The room is a fixed-height,
          overflow-hidden container so a board never drags the page around
          mid-tap — but that also meant a game taller than the viewport (Salvo
          stacks two grids) was silently squeezed with no way to reach the rest.
          Scrolling here keeps the score line and the result card pinned while
          giving the board somewhere to go. `overscroll-contain` stops a flick at
          the end of the board turning into a pull-to-refresh.

          The inner `min-h-full` wrapper is what makes that safe. Every view
          centres itself with `justify-center`, and a flex child that overflows a
          centred container spills equally past *both* edges — including the top,
          which no amount of scrolling can reach. Letting the wrapper grow past
          the viewport instead leaves `justify-center` with no free space to
          distribute, so tall boards start at their true top and short ones stay
          centred exactly as before. */}
      <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        {/* Input is blocked for the whole count, not just visually covered: the
            overlay does not span the score line, and a tap that lands on the
            board a frame before "Go" would otherwise still count. */}
        <div
          className="flex min-h-full flex-col"
          style={counting ? { pointerEvents: 'none' } : undefined}
        >
          <View state={state} ctx={ctx} clock={clock} send={match.send} />
        </div>
      </div>

      <Countdown clock={clock} />

      <AnimatePresence>
        {!opponentPresent && !over ? <DroppedOverlay onExit={onExit} /> : null}
      </AnimatePresence>

      <AnimatePresence>
        {over ? (
          <ResultOverlay
            won={youWon}
            tied={tied}
            mine={mine}
            theirs={theirs}
            opponentLabel={opponentLabel}
            onRematch={match.rematch}
            onChange={onExit}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function ScoreCell({
  label,
  value,
  leading,
  align,
}: {
  label: string
  value: number
  leading: boolean
  align: 'left' | 'right'
}) {
  return (
    <div className={`flex min-w-14 flex-col gap-1 ${align === 'right' ? 'items-end' : 'items-start'}`}>
      <span className="chrome text-muted">{label}</span>
      <motion.span
        animate={{ color: leading ? 'var(--t-accent)' : 'var(--t-ink)' }}
        transition={spring}
        className="display text-[2.25rem] leading-none sm:text-[2.75rem] short:text-[1.5rem]"
      >
        <Counter value={value} />
      </motion.span>
    </div>
  )
}

/** Shown when the opponent stops syncing mid-match. */
function DroppedOverlay({ onExit }: { onExit: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-20 grid place-items-center bg-bg/80 px-6 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.98, opacity: 0 }}
        transition={springScreen}
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center"
      >
        <div className="mx-auto mb-4 flex h-2 w-2 items-center justify-center">
          <motion.span
            animate={{ opacity: [1, 0.25, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="block h-2 w-2 rounded-full bg-accent"
          />
        </div>
        <h2 className="display text-2xl">Opponent dropped</h2>
        <p className="mt-2 text-sm text-muted">
          Waiting for them to come back. They keep their seat if they reopen the room.
        </p>
        <div className="mt-5">
          <Button variant="secondary" full onClick={onExit}>
            Leave the match
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ResultOverlay({
  won,
  tied,
  mine,
  theirs,
  opponentLabel,
  onRematch,
  onChange,
}: {
  won: boolean
  tied: boolean
  mine: number
  theirs: number
  opponentLabel: string
  onRematch: () => void
  onChange: () => void
}) {
  const headline = tied ? 'Dead heat' : won ? 'You win' : 'You lose'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-20 flex items-end justify-center bg-bg/80 backdrop-blur-md sm:items-center"
    >
      <motion.div
        initial={{ y: 40, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={springSoft}
        className="safe-b w-full max-w-md rounded-t-3xl border border-line bg-surface p-6 sm:rounded-3xl sm:p-8"
      >
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSoft, delay: 0.06 }}
          className="display text-[2.75rem] sm:text-[3.25rem]"
          style={{ color: tied ? undefined : won ? 'var(--t-accent)' : undefined }}
        >
          {headline}
        </motion.h2>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.14 }}
          className="mt-5 flex items-center gap-6 border-t border-line pt-5"
        >
          <div className="flex flex-col gap-1">
            <span className="chrome text-muted">You</span>
            <span className="display text-3xl">
              <Counter value={mine} />
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="chrome text-muted">{opponentLabel}</span>
            <span className="display text-3xl">
              <Counter value={theirs} />
            </span>
          </div>
        </motion.div>

        <div className="mt-6 flex flex-col gap-2.5">
          <Button full size="lg" onClick={onRematch}>
            Rematch
          </Button>
          <Button full variant="secondary" onClick={onChange}>
            Pick another game
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
