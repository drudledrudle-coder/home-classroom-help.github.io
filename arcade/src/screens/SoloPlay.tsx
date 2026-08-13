import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Counter } from '../components/Counter'
import { TopBar } from '../components/TopBar'
import { readBest, submitScore } from '../games/solo/bests'
import { SOLO_GAMES } from '../games/solo/registry'
import type { SoloApi, SoloId } from '../games/solo/types'
import { spring, springSoft } from '../lib/motion'
import { useSound } from '../lib/sound'

/**
 * Shell for solo runs: keeps the score, owns the personal best, and shows the
 * result. A game only implements its own board.
 */
export function SoloPlay({ id, onExit }: { id: SoloId; onExit: () => void }) {
  const module = SOLO_GAMES[id]
  const sound = useSound()

  const [score, setScore] = useState(0)
  const [over, setOver] = useState(false)
  /** Bumped to restart, which remounts the board with fresh internal state. */
  const [run, setRun] = useState(0)
  const [best, setBest] = useState<number | null>(() => readBest(id))
  const [isRecord, setIsRecord] = useState(false)

  // The board calls end() from a timeout; without this guard a late timer
  // firing after the run already ended would score twice.
  const ended = useRef(false)
  // The score is mirrored into a ref so end() can read the final value without
  // doing its work inside a state updater, which must stay pure.
  const scoreRef = useRef(0)

  const api = useMemo<SoloApi>(
    () => ({
      setScore: (value) => {
        scoreRef.current = value
        setScore(value)
      },
      end: () => {
        if (ended.current) return
        ended.current = true

        const final = scoreRef.current
        const record = submitScore(id, final, module.meta.direction)
        setIsRecord(record)
        if (record) setBest(final)
        sound.play(record ? 'win' : 'lose')
        setOver(true)
      },
    }),
    [id, module.meta.direction, sound],
  )

  const again = useCallback(() => {
    ended.current = false
    scoreRef.current = 0
    setScore(0)
    setIsRecord(false)
    setOver(false)
    setRun((n) => n + 1)
  }, [])

  const Play = module.Play

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      <TopBar onBack={onExit} center={<Title text={module.meta.title} />} />

      <div className="mx-auto flex w-full max-w-md items-end justify-between px-4 pt-3 sm:px-6 short:pt-1">
        <div className="flex flex-col gap-1">
          <span className="chrome text-muted">Score</span>
          <span className="display text-[2.25rem] leading-none sm:text-[2.75rem] short:text-[1.5rem]">
            <Counter value={score} />
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 pb-1">
          <span className="chrome text-muted">Best</span>
          <span className="chrome tnum">{best ?? '—'}</span>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <Play key={run} api={api} />
      </div>

      <AnimatePresence>
        {over ? (
          <Result
            score={score}
            best={best}
            unit={module.meta.unit}
            isRecord={isRecord}
            onAgain={again}
            onExit={onExit}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function Title({ text }: { text: string }) {
  return (
    <span className="chrome rounded-lg border border-line bg-surface px-2.5 py-1.5 text-muted">
      {text}
    </span>
  )
}

function Result({
  score,
  best,
  unit,
  isRecord,
  onAgain,
  onExit,
}: {
  score: number
  best: number | null
  unit: string
  isRecord: boolean
  onAgain: () => void
  onExit: () => void
}) {
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
        <AnimatePresence mode="wait">
          {isRecord ? (
            <motion.span
              key="record"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              className="chrome text-accent"
            >
              New best
            </motion.span>
          ) : (
            <motion.span key="done" className="chrome text-muted">
              Run over
            </motion.span>
          )}
        </AnimatePresence>

        <div className="mt-2 flex items-baseline gap-3">
          <span
            className="display text-[3.5rem] leading-none sm:text-[4rem]"
            style={{ color: isRecord ? 'var(--t-accent)' : undefined }}
          >
            <Counter value={score} />
          </span>
          <span className="chrome text-muted">{unit}</span>
        </div>

        {best !== null && !isRecord ? (
          <p className="mt-3 text-[0.875rem] text-muted">
            Your best is {best}. {best - score === 1 ? 'One off.' : `${best - score} away.`}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2.5">
          <Button full size="lg" onClick={onAgain}>
            Go again
          </Button>
          <Button full variant="secondary" onClick={onExit}>
            Back
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
