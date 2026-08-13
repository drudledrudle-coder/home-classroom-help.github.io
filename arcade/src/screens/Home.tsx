import { motion } from 'motion/react'
import { useCallback, useState } from 'react'
import type { GameId } from '../../shared/protocol'
import { CODE_LENGTH } from '../../shared/protocol'
import { Button } from '../components/Button'
import { CodeInput } from '../components/CodeInput'
import { BotIcon, LinkIcon } from '../components/icons'
import { Press } from '../components/Press'
import { TopBar } from '../components/TopBar'
import { GAMES, GAME_ORDER } from '../games/registry'
import { fadeUp, spring, stagger } from '../lib/motion'

export function Home({
  onCreate,
  onJoin,
  onSolo,
  initialCode = '',
}: {
  onCreate: () => void
  onJoin: (code: string) => void
  onSolo: (game?: GameId) => void
  initialCode?: string
}) {
  const [code, setCode] = useState(initialCode)

  const join = useCallback(
    (value: string) => {
      if (value.length === CODE_LENGTH) onJoin(value)
    },
    [onJoin],
  )

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopBar />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-10 sm:px-6">
        <motion.div {...fadeUp} className="pt-10 pb-8 sm:pt-16 sm:pb-12">
          <h1 className="display text-[3.25rem] leading-[0.88] sm:text-[4.5rem]">
            Two players.
            <br />
            <span className="text-muted">Two minutes.</span>
          </h1>
          <p className="mt-5 max-w-sm text-[0.9375rem] leading-relaxed text-muted">
            Four small games. Make a room, send the code, play. No accounts, nothing to install.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.06 }}
          className="flex flex-col gap-2.5"
        >
          <Button size="lg" full onClick={onCreate}>
            <LinkIcon size={17} />
            Create a room
          </Button>
          <Button size="lg" full variant="secondary" onClick={() => onSolo()}>
            <BotIcon size={17} />
            Play the bot
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.16 }}
          className="pt-9 pb-8"
        >
          <div className="flex items-center gap-4 pb-5">
            <span className="h-px flex-1 bg-line" />
            <span className="chrome text-muted">or join a room</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <CodeInput value={code} onChange={setCode} onComplete={join} />
        </motion.div>

        <div className="mt-auto">
          <span className="chrome text-muted">The games</span>
          <ul className="mt-3 flex flex-col">
            {GAME_ORDER.map((id, i) => {
              const { meta } = GAMES[id]
              return (
                <motion.li
                  key={id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={stagger(i + 3)}
                >
                  <Press
                    cue="tap"
                    depth={0.985}
                    onClick={() => onSolo(id)}
                    aria-label={`Play ${meta.title} against the bot`}
                    className="flex w-full items-baseline gap-3 border-b border-line py-3.5 text-left"
                  >
                    <span className="display w-full max-w-[8.5rem] shrink-0 text-[1.0625rem]">
                      {meta.title}
                    </span>
                    <span className="flex-1 text-[0.8125rem] leading-snug text-muted">
                      {meta.rule}
                    </span>
                  </Press>
                </motion.li>
              )
            })}
          </ul>
          <p className="pt-3 text-[0.75rem] text-muted/70">
            Tap any game to play it against the bot right now.
          </p>
        </div>
      </main>
    </div>
  )
}
