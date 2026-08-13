import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useState } from 'react'
import { Button } from '../../../components/Button'
import { Press } from '../../../components/Press'
import { spring, springSnap, springSoft } from '../../../lib/motion'
import { useSound } from '../../../lib/sound'
import { SECRETS } from '../words'
import type { Secret } from '../words'
import type { PartyModule } from '../types'

const MIN_PLAYERS = 3
const MAX_PLAYERS = 10

type Stage = 'setup' | 'dealing' | 'discuss' | 'revealed'

type Round = { secret: Secret; imposter: number }

function newRound(players: number): Round {
  return {
    secret: SECRETS[Math.floor(Math.random() * SECRETS.length)],
    imposter: Math.floor(Math.random() * players),
  }
}

const NAMES_KEY = 'arcade.imposter.names'

/** Remembered between rounds and sessions — nobody wants to retype six names. */
function loadNames(): string[] {
  try {
    const raw = localStorage.getItem(NAMES_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

function saveNames(names: string[]): void {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names))
  } catch {
    /* storage disabled; the names still hold for this session */
  }
}

function ImposterPlay({ onExit }: { onExit: () => void }) {
  const sound = useSound()
  const [players, setPlayers] = useState(4)
  const [names, setNames] = useState<string[]>(loadNames)

  /** A blank entry falls back to the position, so names are always optional. */
  const nameOf = useCallback(
    (i: number) => names[i]?.trim() || `Player ${i + 1}`,
    [names],
  )

  const rename = useCallback((i: number, value: string) => {
    setNames((prev) => {
      const next = [...prev]
      while (next.length <= i) next.push('')
      next[i] = value.slice(0, 14)
      saveNames(next)
      return next
    })
  }, [])
  const [stage, setStage] = useState<Stage>('setup')
  const [round, setRound] = useState<Round>(() => newRound(4))
  const [current, setCurrent] = useState(0)
  const [held, setHeld] = useState(false)

  const begin = useCallback(() => {
    setRound(newRound(players))
    setCurrent(0)
    setHeld(false)
    setStage('dealing')
    sound.play('confirm')
  }, [players, sound])

  const nextPlayer = useCallback(() => {
    setHeld(false)
    if (current + 1 >= players) {
      setStage('discuss')
      sound.play('confirm')
    } else {
      setCurrent((n) => n + 1)
      sound.play('tap')
    }
  }, [current, players, sound])

  const isImposter = current === round.imposter

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-6">
      <AnimatePresence mode="wait" initial={false}>
        {stage === 'setup' ? (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring}
          >
            <span className="chrome text-muted">One phone, passed around</span>
            <h2 className="display mt-2 text-[2.5rem] leading-[0.95]">How many playing?</h2>

            <div className="mt-8 flex items-center justify-between rounded-2xl border border-line bg-surface p-3">
              <Press
                cue="tap"
                depth={0.88}
                aria-label="Fewer players"
                disabled={players <= MIN_PLAYERS}
                onClick={() => setPlayers((n) => Math.max(MIN_PLAYERS, n - 1))}
                className="grid h-14 w-14 place-items-center rounded-xl border border-line-strong disabled:opacity-30"
              >
                <span className="display text-2xl">−</span>
              </Press>

              <motion.span
                key={players}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={springSnap}
                className="display text-[3.5rem] tabular-nums"
              >
                {players}
              </motion.span>

              <Press
                cue="tap"
                depth={0.88}
                aria-label="More players"
                disabled={players >= MAX_PLAYERS}
                onClick={() => setPlayers((n) => Math.min(MAX_PLAYERS, n + 1))}
                className="grid h-14 w-14 place-items-center rounded-xl border border-line-strong disabled:opacity-30"
              >
                <span className="display text-2xl">+</span>
              </Press>
            </div>

            {/* Names are optional: leave one blank and it stays "Player n".
                Capped in height so a ten-player game does not push the deal
                button off the screen. */}
            <div className="mt-4 max-h-[32vh] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-2">
              {Array.from({ length: players }, (_, i) => (
                <label key={i} className="flex items-center gap-3 px-1 py-1">
                  <span className="chrome w-6 shrink-0 text-muted/60 tabular-nums">{i + 1}</span>
                  <input
                    value={names[i] ?? ''}
                    onChange={(e) => rename(i, e.target.value)}
                    placeholder={`Player ${i + 1}`}
                    aria-label={`Name for player ${i + 1}`}
                    maxLength={14}
                    className="h-10 w-full min-w-0 rounded-lg bg-bg/60 px-3 text-[0.9375rem] text-ink outline-none placeholder:text-muted/50 focus-visible:outline-2 focus-visible:outline-accent"
                  />
                </label>
              ))}
            </div>

            <p className="mt-4 text-[0.875rem] leading-relaxed text-muted">
              Everyone gets the same secret word except one person, who only sees the category
              and has to bluff. Hold to read yours, then pass the phone on.
            </p>

            <div className="mt-6">
              <Button size="lg" full onClick={begin}>
                Deal the words
              </Button>
            </div>
          </motion.div>
        ) : stage === 'dealing' ? (
          <motion.div
            key={`deal-${current}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring}
            className="flex flex-col"
          >
            <span className="chrome text-muted">
              {nameOf(current)} — {current + 1} of {players}
            </span>

            {/* Hold rather than tap: the word is only on screen while a finger
                is down, so nobody can leave it showing as they hand it over. */}
            <Press
              cue={null}
              depth={0.99}
              aria-label="Hold to reveal your word"
              onPointerDown={() => {
                setHeld(true)
                sound.play('pop')
              }}
              onPointerUp={() => setHeld(false)}
              onPointerLeave={() => setHeld(false)}
              onPointerCancel={() => setHeld(false)}
              className="no-select mt-3 grid min-h-[15rem] w-full place-items-center rounded-3xl border border-line bg-surface px-5 py-8"
            >
              {/* No `mode="wait"` and a near-instant exit: the word has to be
                  gone the moment the finger lifts. Letting it fade out over a
                  spring would leave the secret on screen while the phone is
                  already being handed to the next player. */}
              <AnimatePresence initial={false}>
                {held ? (
                  <motion.div
                    key="word"
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1, transition: { duration: 0.06 } }}
                    transition={springSoft}
                    className="absolute flex flex-col items-center gap-2 text-center"
                  >
                    {isImposter ? (
                      <>
                        {/* Fixed red, never the accent. This is the one line in
                            the app that must be unmistakable at a glance while
                            a phone is being passed around, and the player can
                            set the accent to anything — including a colour that
                            would make "you are the imposter" look reassuring. */}
                        <span
                          className="chrome rounded-md px-2 py-1"
                          style={{
                            color: 'var(--t-danger)',
                            backgroundColor: 'var(--t-danger-wash)',
                          }}
                        >
                          You are the imposter
                        </span>
                        <span className="display text-[2rem] leading-tight">
                          {round.secret.category}
                        </span>
                        <span className="mt-1 text-[0.8125rem] text-muted">
                          That is all you get. Bluff.
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="chrome text-muted">{round.secret.category}</span>
                        <span className="display text-[2.5rem] leading-tight">
                          {round.secret.word}
                        </span>
                      </>
                    )}
                  </motion.div>
                ) : (
                  <motion.span
                    key="prompt"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.06 } }}
                    className="chrome text-muted"
                  >
                    Hold to reveal
                  </motion.span>
                )}
              </AnimatePresence>
            </Press>

            <div className="mt-4">
              <Button size="lg" full variant="secondary" onClick={nextPlayer}>
                {current + 1 >= players ? 'Everyone has seen it' : 'Pass to the next player'}
              </Button>
            </div>
          </motion.div>
        ) : stage === 'discuss' ? (
          <motion.div
            key="discuss"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring}
          >
            <span className="chrome text-muted">Now put the phone down</span>
            <h2 className="display mt-2 text-[2.25rem] leading-[0.98]">Say one word each</h2>

            <ol className="mt-6 flex flex-col gap-3">
              {[
                'Go round the group. Each person says one word linked to the secret word.',
                'Nothing too obvious — you would be handing it to the imposter.',
                'Go round again if you want, then argue and vote.',
              ].map((line, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...spring, delay: 0.06 * i }}
                  className="flex gap-3 text-[0.9375rem] leading-relaxed text-muted"
                >
                  <span className="chrome pt-1 text-accent">{i + 1}</span>
                  {line}
                </motion.li>
              ))}
            </ol>

            <div className="mt-8 flex flex-col gap-2.5">
              <Button
                size="lg"
                full
                onClick={() => {
                  setStage('revealed')
                  sound.play('win')
                }}
              >
                Reveal the imposter
              </Button>
              <Button full variant="ghost" onClick={begin}>
                New round
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="revealed"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring}
          >
            <span className="chrome text-muted">The word was</span>
            <h2 className="display mt-2 text-[3rem] leading-[0.95]">{round.secret.word}</h2>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: 0.12 }}
              className="mt-6 rounded-2xl border border-line bg-surface p-5"
            >
              <span className="chrome text-muted">The imposter was</span>
              <p className="display mt-1.5 text-[2rem]" style={{ color: 'var(--t-danger)' }}>
                {nameOf(round.imposter)}
              </p>
            </motion.div>

            <div className="mt-8 flex flex-col gap-2.5">
              <Button size="lg" full onClick={begin}>
                Another round
              </Button>
              <Button full variant="secondary" onClick={onExit}>
                Back
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export const imposterGame: PartyModule = {
  meta: {
    id: 'imposter',
    title: 'Imposter',
    rule: 'Everyone sees the same secret word except one — say a clue each and work out who is faking.',
    players: '3–10 players, one phone',
  },
  Play: ImposterPlay,
}
