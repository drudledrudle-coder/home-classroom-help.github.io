import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { OTHER } from '../../shared/protocol'
import type { Slot } from '../../shared/protocol'
import { Button } from '../components/Button'
import { DifficultySlider } from '../components/DifficultySlider'
import { CheckIcon } from '../components/icons'
import type { AnyGameModule } from '../games/types'
import { spring, springSnap } from '../lib/motion'

/**
 * The beat between choosing a game and playing it: states the single rule,
 * waits for both players, and gives a game with async assets somewhere to load
 * them. Nobody can ready up before `prepare` resolves, which guarantees both
 * reducers have what they need before the first event.
 */
export function ReadyGate({
  module,
  ready,
  slot,
  isBot,
  onReady,
  onBack,
}: {
  module: AnyGameModule
  ready: Record<Slot, boolean>
  slot: Slot
  isBot: boolean
  onReady: () => void
  onBack: () => void
}) {
  const [prepared, setPrepared] = useState(!module.prepare)

  useEffect(() => {
    if (!module.prepare) {
      setPrepared(true)
      return
    }
    let alive = true
    setPrepared(false)
    module.prepare().then(
      () => alive && setPrepared(true),
      () => alive && setPrepared(true),
    )
    return () => {
      alive = false
    }
  }, [module])

  const iAmReady = ready[slot]
  const theyAreReady = ready[OTHER[slot]]

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <span className="chrome text-muted">{module.meta.format}</span>
        <h2 className="display mt-2 text-[2.5rem] leading-[0.95] sm:text-[3rem]">
          {module.meta.title}
        </h2>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted">{module.meta.rule}</p>
      </motion.div>

      <div className="mt-9 flex flex-col gap-2.5">
        {/* Only shown against the bot, and only before the match starts —
            changing it mid-game would be changing the rules mid-game. */}
        {isBot && !iAmReady ? <DifficultySlider /> : null}

        <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3">
          <span className="chrome text-muted">{isBot ? 'Bot' : 'Opponent'}</span>
          <ReadyFlag on={theyAreReady} />
        </div>

        <Button
          size="lg"
          full
          disabled={!prepared || iAmReady}
          onClick={onReady}
        >
          {!prepared ? 'Loading…' : iAmReady ? 'Waiting for them…' : "I'm ready"}
        </Button>

        <Button full variant="ghost" onClick={onBack}>
          Pick a different game
        </Button>
      </div>
    </div>
  )
}

function ReadyFlag({ on }: { on: boolean }) {
  return (
    <motion.span
      animate={{ color: on ? 'var(--t-accent)' : 'var(--t-muted)' }}
      transition={springSnap}
      className="chrome flex items-center gap-1.5"
    >
      {on ? <CheckIcon size={14} /> : null}
      {on ? 'Ready' : 'Not ready'}
    </motion.span>
  )
}
