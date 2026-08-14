import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useState } from 'react'
import type { GameId } from '../../shared/protocol'
import { CODE_LENGTH } from '../../shared/protocol'
import { Button } from '../components/Button'
import { CodeInput } from '../components/CodeInput'
import { Magnetic } from '../components/Magnetic'
import { Press } from '../components/Press'
import { TopBar } from '../components/TopBar'
import { GAMES, GAME_ORDER } from '../games/registry'
import { PARTY_GAMES, PARTY_ORDER } from '../games/party/registry'
import type { PartyId } from '../games/party/types'
import { readBest } from '../games/solo/bests'
import { SOLO_GAMES, SOLO_ORDER } from '../games/solo/registry'
import type { SoloId } from '../games/solo/types'
import { spring, springSnap, stagger } from '../lib/motion'
import { usePointerFine } from '../lib/pointer'
import { useOnline } from '../lib/pwa'

export function Home({
  onCreate,
  onJoin,
  onSolo,
  onSoloScore,
  onParty,
  initialCode = '',
}: {
  onCreate: () => void
  onJoin: (code: string) => void
  onSolo: (game?: GameId) => void
  onSoloScore: (game: SoloId) => void
  onParty: (game: PartyId) => void
  initialCode?: string
}) {
  const [code, setCode] = useState(initialCode)
  const online = useOnline()

  const join = useCallback(
    (value: string) => {
      if (value.length === CODE_LENGTH) onJoin(value)
    },
    [onJoin],
  )

  return (
    <div className="relative flex min-h-[100dvh] flex-col">
      <TopBar />

      {/* `content-start` matters: without it the grid stretches its rows to fill
          the flex-1 main, which opens a dead gap between the two sections on
          any single-column screen tall enough to have slack (iPad portrait). */}
      <main className="relative z-10 mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 content-start gap-11 px-5 pt-10 pb-14 sm:px-8 sm:pt-14 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:content-center md:gap-12 md:pb-20 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-20">
        {/* A room needs the server, so with no network these controls cannot do
            anything. They are disabled and labelled rather than hidden: a
            control that vanishes reads as a broken build, where one that says
            why reads as a temporary state — and everything below still plays. */}
        <section>
          <SectionLabel>Two players</SectionLabel>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="mt-4"
          >
            <Magnetic strength={online ? 0.16 : 0}>
              <Button size="lg" full onClick={onCreate} disabled={!online}>
                Create a room
              </Button>
            </Magnetic>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.06 }}
            className="mt-7"
          >
            <SectionLabel>Have a code</SectionLabel>
            <div className="mt-3.5">
              <CodeInput value={code} onChange={setCode} onComplete={join} disabled={!online} />
            </div>
          </motion.div>

          <AnimatePresence>
            {!online ? (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={springSnap}
                className="mt-4 text-[0.8125rem] text-muted"
              >
                Rooms need a connection. Everything on the right plays offline —
                the bot included.
              </motion.p>
            ) : null}
          </AnimatePresence>
        </section>

        <section className="lg:pt-0">
          <SectionLabel>Two players, or against the bot</SectionLabel>
          <GameIndex onPick={onSolo} />

          <div className="mt-10">
            <SectionLabel>On your own</SectionLabel>
            <SoloIndex onPick={onSoloScore} />
          </div>

          <div className="mt-10">
            <SectionLabel>Everyone, one phone</SectionLabel>
            <PartyIndex onPick={onParty} />
          </div>
        </section>
      </main>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="chrome text-muted/70">{children}</span>
}

/** Single-device group games. */
function PartyIndex({ onPick }: { onPick: (id: PartyId) => void }) {
  return (
    <ul className="mt-2 border-t border-line">
      {PARTY_ORDER.map((id, i) => {
        const { meta } = PARTY_GAMES[id]
        return (
          <motion.li
            key={id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={stagger(i + GAME_ORDER.length + SOLO_ORDER.length, 0.05)}
            className="border-b border-line"
          >
            <Press
              cue="tap"
              depth={0.99}
              onClick={() => onPick(id)}
              aria-label={`Play ${meta.title}`}
              className="flex w-full items-baseline gap-4 py-5 text-left sm:gap-6"
            >
              <span className="display min-w-0 flex-1 text-[1.5rem] leading-none sm:text-[1.875rem]">
                {meta.title}
              </span>
              <span className="chrome shrink-0 text-muted/60">{meta.players}</span>
            </Press>
          </motion.li>
        )
      })}
    </ul>
  )
}

/** Solo score games, with the number to beat shown inline. */
function SoloIndex({ onPick }: { onPick: (id: SoloId) => void }) {
  return (
    <ul className="mt-2 border-t border-line">
      {SOLO_ORDER.map((id, i) => {
        const { meta } = SOLO_GAMES[id]
        const best = readBest(id)
        return (
          <motion.li
            key={id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={stagger(i + GAME_ORDER.length, 0.06)}
            className="border-b border-line"
          >
            <Press
              cue="tap"
              depth={0.99}
              onClick={() => onPick(id)}
              aria-label={`Play ${meta.title}`}
              className="flex w-full items-baseline gap-4 py-5 text-left sm:gap-6"
            >
              <span className="display min-w-0 flex-1 text-[1.5rem] leading-none sm:text-[1.875rem]">
                {meta.title}
              </span>
              <span className="chrome shrink-0 text-muted/60">
                {best === null ? 'No score yet' : `Best ${best}`}
              </span>
            </Press>
          </motion.li>
        )
      })}
    </ul>
  )
}

/**
 * The games as a numbered index rather than a grid of cards. An accent rule
 * slides between rows under the cursor — one shared `layoutId`, so it is a
 * single element travelling rather than four fading in and out.
 */
function GameIndex({ onPick }: { onPick: (id: GameId) => void }) {
  const [active, setActive] = useState<number | null>(null)
  const fine = usePointerFine()

  return (
    <ul className="mt-2 border-t border-line">
      {GAME_ORDER.map((id, i) => {
        const { meta } = GAMES[id]
        const lit = active === i

        return (
          <motion.li
            key={id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={stagger(i, 0.06)}
            className="relative border-b border-line"
            onPointerEnter={() => fine && setActive(i)}
            onPointerLeave={() => fine && setActive(null)}
          >
            {lit ? (
              <motion.span
                layoutId="index-rule"
                transition={spring}
                className="absolute inset-y-0 -left-3 w-[2px] bg-accent sm:-left-4"
              />
            ) : null}

            <Press
              cue="tap"
              depth={0.99}
              onClick={() => onPick(id)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`Play ${meta.title} against the bot`}
              className="flex w-full items-baseline gap-4 py-5 text-left sm:gap-6 sm:py-6"
            >
              <span className="chrome tnum w-5 shrink-0 text-muted/50">
                {String(i + 1).padStart(2, '0')}
              </span>

              <motion.span
                animate={{ x: lit ? 5 : 0 }}
                transition={spring}
                className="display min-w-0 flex-1 text-[1.5rem] leading-none sm:text-[1.875rem]"
              >
                {meta.title}
              </motion.span>

              <span className="relative flex shrink-0 items-center justify-end">
                <AnimatePresence mode="wait" initial={false}>
                  {lit ? (
                    <motion.span
                      key="go"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 6 }}
                      transition={springSnap}
                      className="chrome text-accent"
                    >
                      Play
                    </motion.span>
                  ) : (
                    <motion.span
                      key="format"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={springSnap}
                      className="chrome text-muted/60"
                    >
                      {meta.format}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </Press>
          </motion.li>
        )
      })}
    </ul>
  )
}
