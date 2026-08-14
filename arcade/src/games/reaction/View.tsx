import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { OTHER } from '../../../shared/protocol'
import type { Slot } from '../../../shared/protocol'
import { Press } from '../../components/Press'
import { useKeyAction } from '../../lib/input'
import { spring, springSnap, springSoft } from '../../lib/motion'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import { EV_TAP, MAX_ROUNDS, TAP_TIMEOUT_MS, waitFor } from './logic'
import type { ReactionState } from './logic'

/** Beat spent showing the previous round's times before arming the next. */
const RESULT_HOLD_MS = 1_500
const FIRST_ROUND_DELAY_MS = 650

type LocalPhase = 'result' | 'arming' | 'go' | 'done'

export function ReactionView({ state, ctx, send }: GameViewProps<ReactionState>) {
  const { slot, seed } = ctx
  const sound = useSound()
  const [phase, setPhase] = useState<LocalPhase>('arming')
  const flipAt = useRef(0)

  // The timers below outlive individual renders, so they read state through a
  // ref rather than closing over a stale copy.
  const latest = useRef(state)
  latest.current = state

  const myTap = state.taps[slot]
  const theirTap = state.taps[OTHER[slot]]
  const over = state.phase === 'over'
  const round = state.round

  /**
   * Arms the round on a purely local clock. Each client flips its own screen
   * and measures against its own flip, so the two times are directly
   * comparable no matter how far apart the players are.
   */
  useEffect(() => {
    if (over) return
    // Rejoining mid-round after a refresh: the tap is already on the log.
    if (latest.current.taps[slot]) {
      setPhase('done')
      return
    }

    const lead = round === 0 ? FIRST_ROUND_DELAY_MS : RESULT_HOLD_MS
    const wait = waitFor(seed, round)
    setPhase(round === 0 ? 'arming' : 'result')

    const toArming = setTimeout(() => setPhase('arming'), round === 0 ? 0 : lead)

    const toGo = setTimeout(() => {
      flipAt.current = performance.now()
      setPhase('go')
      sound.play('pop')
    }, lead + wait)

    // Never leave a round hanging on a player who walked away.
    const toTimeout = setTimeout(
      () => {
        if (!latest.current.taps[slot] && latest.current.phase === 'playing') {
          send(EV_TAP, { ms: TAP_TIMEOUT_MS, foul: false })
          setPhase('done')
        }
      },
      lead + wait + TAP_TIMEOUT_MS,
    )

    return () => {
      clearTimeout(toArming)
      clearTimeout(toGo)
      clearTimeout(toTimeout)
    }
  }, [round, over, seed, slot, send, sound])

  /**
   * One answer per round, decided synchronously.
   *
   * `phase` and the log are both state, so two events in the same frame — a
   * pointerdown and a key, say — could each see a round that had not been
   * answered yet and both send a tap.
   */
  const answered = useRef(false)
  useEffect(() => {
    answered.current = false
  }, [round])

  const onTap = useCallback(() => {
    if (over || answered.current || latest.current.taps[slot]) return

    // The beat between rounds, showing the last one's times. The next round has
    // not started, so a tap here is not early — it is not in a round at all.
    // Fouling it punished ordinary impatience, ended the round on the spot, and
    // sent an event nobody was waiting for.
    if (phase === 'result' || phase === 'done') return

    if (phase === 'arming') {
      answered.current = true
      send(EV_TAP, { ms: 0, foul: true })
      setPhase('done')
      sound.play('foul')
      return
    }
    if (phase === 'go') {
      // Read the clock before anything else in this handler can delay it.
      const ms = Math.round(performance.now() - flipAt.current)
      answered.current = true
      send(EV_TAP, { ms, foul: false })
      setPhase('done')
      sound.play('confirm')
    }
  }, [phase, over, slot, send, sound])

  // The whole game is one action, so it gets one key.
  useKeyAction(['Space', 'Enter'], onTap, !over)

  const last = state.history[state.history.length - 1]
  const showResult = phase === 'result' && last
  /** The accent fill belongs to a live round only. */
  const lit = phase === 'go' && !over

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-4 pb-5 sm:px-6">
      <Pips history={state.history} round={round} slot={slot} />

      <Press
        cue={null}
        depth={0.985}
        // Pointer *down*, not click. A click fires on release, so the game was
        // timing when the finger came off the glass rather than when it landed —
        // in a game whose entire subject is that interval. Safe to double up
        // with the key handler because `answered` resolves the round on the
        // first of the two synchronously.
        onPress={onTap}
        disabled={over}
        aria-label={phase === 'go' ? 'Tap now' : 'Wait for the colour change, then tap'}
        className="no-select relative mt-4 flex flex-1 items-center justify-center overflow-hidden rounded-3xl border"
        style={{
          minHeight: 'min(58vh, 30rem)',
          borderColor: lit ? 'transparent' : 'var(--t-line)',
        }}
      >
        {/* The flip itself: a colour fill that appears almost instantly, so the
            change is unmistakable in peripheral vision. Dropped the moment the
            match ends, so the result card is never read against a red field. */}
        <motion.span
          className="absolute inset-0"
          initial={false}
          animate={{ backgroundColor: lit ? 'var(--t-accent)' : 'var(--t-surface)' }}
          transition={{ duration: lit ? 0.06 : 0.28 }}
        />

        <AnimatePresence mode="wait" initial={false}>
          {showResult ? (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={springSoft}
              className="relative flex flex-col items-center gap-5"
            >
              <span className="chrome text-muted">
                {last.winner === 'tie' ? 'Split' : last.winner === slot ? 'You took it' : 'They took it'}
              </span>
              <div className="flex items-end gap-8">
                <TimeCell label="You" tap={last[slot]} won={last.winner === slot} />
                <TimeCell label="Them" tap={last[OTHER[slot]]} won={last.winner === OTHER[slot]} />
              </div>
            </motion.div>
          ) : phase === 'arming' ? (
            <motion.div
              key="arming"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative flex flex-col items-center gap-4"
            >
              <motion.span
                animate={{ opacity: [0.35, 0.9, 0.35] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="chrome text-muted"
              >
                Wait for it
              </motion.span>
              <span className="display text-[2rem] text-muted/40">Round {round + 1}</span>
            </motion.div>
          ) : phase === 'go' ? (
            <motion.span
              key="go"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={springSnap}
              className="display relative text-[4.5rem] text-accent-ink sm:text-[6rem]"
            >
              TAP
            </motion.span>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={springSoft}
              className="relative flex flex-col items-center gap-3"
            >
              {myTap?.foul ? (
                <>
                  {/* Fixed red rather than the accent: this is the one outcome
                      where the player lost the round by their own hand, and it
                      must not be tinted by whichever colour they picked. */}
                  <span
                    className="display text-[2.5rem] sm:text-[3rem]"
                    style={{ color: 'var(--t-danger)' }}
                  >
                    Too early
                  </span>
                  <span className="chrome text-muted">Round lost</span>
                </>
              ) : (
                <>
                  <span className="display text-[4rem] tabular-nums sm:text-[5rem]">
                    {myTap?.ms ?? 0}
                    <span className="text-[1.5rem] text-muted"> ms</span>
                  </span>
                  <span className="chrome text-muted">
                    {theirTap ? 'Scoring' : 'Waiting for them'}
                  </span>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Press>
    </div>
  )
}

function TimeCell({ label, tap, won }: { label: string; tap: { ms: number; foul: boolean } | null; won: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="chrome text-muted">{label}</span>
      <span
        className="display text-[2.25rem] tabular-nums sm:text-[2.75rem]"
        style={{ color: won ? 'var(--t-accent)' : 'var(--t-ink)' }}
      >
        {tap?.foul ? 'foul' : `${tap?.ms ?? 0}`}
      </span>
    </div>
  )
}

/** Five slots: rounds you took fill with the accent, theirs stay neutral. */
function Pips({
  history,
  round,
  slot,
}: {
  history: ReactionState['history']
  round: number
  slot: Slot
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: MAX_ROUNDS }, (_, i) => {
        const done = history[i]
        const active = i === round
        const mine = done?.winner === slot
        return (
          <motion.span
            key={i}
            initial={false}
            animate={{
              width: active && !done ? 26 : 8,
              backgroundColor: done
                ? mine
                  ? 'var(--t-accent)'
                  : 'var(--t-line-strong)'
                : active
                  ? 'var(--t-ink)'
                  : 'var(--t-line)',
              opacity: done && done.winner === 'tie' ? 0.35 : 1,
            }}
            transition={spring}
            className="block h-2 rounded-full"
          />
        )
      })}
    </div>
  )
}
