import { motion } from 'motion/react'
import type { GameId } from '../../shared/protocol'
import { Press } from '../components/Press'
import { GAMES, GAME_ORDER } from '../games/registry'
import { spring, stagger } from '../lib/motion'

export function GamePicker({
  onPick,
  isBot,
}: {
  onPick: (id: GameId) => void
  isBot: boolean
}) {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-5 pt-6 pb-10 sm:px-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <h2 className="display text-[2rem] sm:text-[2.5rem]">Pick a game</h2>
        <p className="mt-1.5 text-[0.875rem] text-muted">
          {isBot ? 'You are playing the bot.' : 'Either of you can choose.'}
        </p>
      </motion.div>

      <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
        {GAME_ORDER.map((id, i) => {
          const { meta } = GAMES[id]
          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(i)}
            >
              <Press
                cue="confirm"
                depth={0.975}
                onClick={() => onPick(id)}
                className="flex h-full w-full flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-5 text-left"
              >
                <div className="flex w-full items-baseline justify-between gap-3">
                  <span className="display text-[1.375rem]">{meta.title}</span>
                  <span className="chrome shrink-0 text-muted">{meta.format}</span>
                </div>
                <span className="text-[0.8125rem] leading-snug text-muted">{meta.rule}</span>
              </Press>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
