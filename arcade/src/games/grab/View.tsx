import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Press } from '../../components/Press'
import { springSnap } from '../../lib/motion'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import { CLAIM_FLASH_MS, EV_CLAIM, scheduleFor } from './logic'
import type { Dot, GrabState } from './logic'

export function GrabView({ state, ctx, clock, send }: GameViewProps<GrabState>) {
  const { slot } = ctx
  const sound = useSound()
  const schedule = useMemo(() => scheduleFor(ctx.seed), [ctx.seed])
  const [live, setLive] = useState<Dot[]>([])

  const claimed = state.claimed
  const claimedRef = useRef(claimed)
  claimedRef.current = claimed

  /**
   * Which dots are on screen is a function of time, so it is driven by rAF —
   * but state is only set when the *set* actually changes. Dots appear a few
   * times a second, not sixty, so the board re-renders a few times a second.
   */
  useEffect(() => {
    if (state.phase === 'over') {
      setLive([])
      return
    }
    let raf = 0
    let signature = ''

    const loop = () => {
      const t = clock.elapsed()
      const now: Dot[] = []
      for (const dot of schedule) {
        if (t < dot.at || t >= dot.at + dot.life) continue
        const claim = claimedRef.current[dot.id]
        if (claim && t >= claim.at + CLAIM_FLASH_MS) continue
        now.push(dot)
      }
      const next = now.map((d) => d.id).join(',')
      if (next !== signature) {
        signature = next
        setLive(now)
      }
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [schedule, clock, state.phase])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-3 pt-3 pb-4 sm:px-6">
      <div className="relative flex-1 overflow-hidden rounded-3xl border border-line bg-surface">
        <AnimatePresence>
          {live.map((dot) => {
            const claim = claimed[dot.id]
            const mine = claim?.by === slot
            return (
              <motion.div
                key={dot.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                  scale: claim ? 1.28 : 1,
                  opacity: claim ? 0 : 1,
                }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={claim ? { duration: CLAIM_FLASH_MS / 1000, ease: 'easeOut' } : springSnap}
                className="absolute"
                style={{
                  left: `${dot.x * 100}%`,
                  top: `${dot.y * 100}%`,
                  // Translate rather than offsetting with margins so the dot
                  // scales about its own centre.
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <Press
                  cue={null}
                  depth={0.82}
                  disabled={!!claim || state.phase === 'over'}
                  aria-label="Claim dot"
                  onPress={() => {
                    if (claimedRef.current[dot.id]) return
                    sound.play('pop')
                    send(EV_CLAIM, { id: dot.id })
                  }}
                  className="grid place-items-center rounded-full disabled:pointer-events-none"
                  style={{
                    width: 'clamp(3rem, 15vw, 4.25rem)',
                    height: 'clamp(3rem, 15vw, 4.25rem)',
                    backgroundColor: claim
                      ? mine
                        ? 'var(--t-accent)'
                        : 'var(--t-ink)'
                      : 'var(--t-accent)',
                  }}
                >
                  <span
                    className="block rounded-full"
                    style={{
                      width: '38%',
                      height: '38%',
                      backgroundColor: 'var(--t-accent-ink)',
                      opacity: claim ? 0 : 0.9,
                    }}
                  />
                </Press>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {!live.length && state.phase === 'playing' ? (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            className="chrome absolute inset-0 grid place-items-center text-muted"
          >
            Watch for dots
          </motion.span>
        ) : null}
      </div>

      <p className="pt-3 text-center text-[0.8125rem] text-muted">
        Tap a dot to claim it. Fastest tap wins the dot.
      </p>
    </div>
  )
}
