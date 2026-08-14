import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Countdown } from '../components/Countdown'
import { Counter } from '../components/Counter'
import { TopBar } from '../components/TopBar'
import { bestIn, readBest, submitScore } from '../games/solo/bests'
import { clearResume } from '../games/solo/resume'
import type { Window as WindowName } from '../games/solo/bests'
import { SOLO_GAMES } from '../games/solo/registry'
import type { SoloApi, SoloId } from '../games/solo/types'
import { spring, springSoft } from '../lib/motion'
import { useSound } from '../lib/sound'
import { COUNTDOWN_MS } from '../net/shellState'

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
  const dir = module.meta.direction
  const [best, setBest] = useState<number | null>(() => readBest(id, dir))
  const [isRecord, setIsRecord] = useState(false)
  /** Which of today / week / all-time this run took, for the result card. */
  const [beaten, setBeaten] = useState<WindowName[]>([])
  const [bests, setBests] = useState<Record<WindowName, number | null>>(() => ({
    today: bestIn(id, 'today', dir),
    week: bestIn(id, 'week', dir),
    all: bestIn(id, 'all', dir),
  }))

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
        const took = submitScore(id, final, module.meta.direction)
        setBeaten(took)
        setIsRecord(took.includes('all'))
        if (took.includes('all')) setBest(final)
        setBests({
          today: bestIn(id, 'today', module.meta.direction),
          week: bestIn(id, 'week', module.meta.direction),
          all: bestIn(id, 'all', module.meta.direction),
        })
        sound.play(took.includes('all') ? 'win' : 'lose')
        setOver(true)
      },
    }),
    [id, module.meta.direction, sound],
  )

  // A local stand-in for the match clock. Solo has no opponent to stay in step
  // with, so the only thing that matters is that the count restarts with the run.
  const startedAt = useRef(Date.now())
  const [counting, setCounting] = useState(!module.meta.selfStart)
  const soloClock = useMemo(
    () => ({
      serverNow: () => Date.now(),
      elapsed: () => Math.max(0, Date.now() - startedAt.current - COUNTDOWN_MS),
      countdown: () => Math.max(0, startedAt.current + COUNTDOWN_MS - Date.now()),
      remaining: () => null,
    }),
    [],
  )

  useEffect(() => {
    if (!counting) return
    let raf = 0
    const tick = () => {
      if (soloClock.countdown() <= 0) return setCounting(false)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [counting, soloClock, run])

  const again = useCallback(() => {
    ended.current = false
    // "Go again" is a fresh run, not a resume — without this the remounted
    // board would load the state it had just finished.
    clearResume(id)
    scoreRef.current = 0
    setScore(0)
    setIsRecord(false)
    setBeaten([])
    setOver(false)
    setRun((n) => n + 1)
    startedAt.current = Date.now()
    if (!module.meta.selfStart) setCounting(true)
  }, [id, module.meta.selfStart])

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
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={counting ? { pointerEvents: 'none' } : undefined}
        >
          <Play key={run} api={api} />
        </div>
        {/* Solo has no shared clock, so the beat is local — but it is the same
            component and the same three seconds as a versus match. Games that
            wait for a first input supply their own beat and opt out. */}
        {!module.meta.selfStart ? <Countdown clock={soloClock} /> : null}
      </div>

      <AnimatePresence>
        {over ? (
          <Result
            score={score}
            best={best}
            bests={bests}
            beaten={beaten}
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

/**
 * Three windows, three weights.
 *
 * All-time carries the accent because it is the one that is genuinely hard to
 * take. Today is the one a player can beat on any given sitting, so it reads as
 * live but quieter; the week sits between them. Deliberately *not* three
 * saturated colours — the point of a minimal palette is that emphasis still
 * means something, and red stays reserved for things that went wrong.
 */
const WINDOWS: Array<{ key: WindowName; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'all', label: 'All time' },
]

function ScoreWindow({
  label,
  value,
  tone,
  fresh,
}: {
  label: string
  value: number | null
  tone: 'today' | 'week' | 'all'
  fresh: boolean
}) {
  const colour =
    tone === 'all' ? 'var(--t-accent)' : tone === 'week' ? 'var(--t-ink)' : 'var(--t-muted)'
  return (
    <motion.div
      animate={fresh ? { scale: [1, 1.06, 1] } : { scale: 1 }}
      transition={springSoft}
      className="flex flex-1 flex-col gap-1 rounded-xl px-3 py-2.5"
      style={{
        backgroundColor: fresh ? 'var(--t-accent-wash)' : 'var(--t-bg)',
        border: `1px solid ${fresh ? 'var(--t-accent)' : 'var(--t-line)'}`,
      }}
    >
      <span className="chrome text-muted/70">{label}</span>
      <span className="display tnum text-[1.375rem] leading-none" style={{ color: colour }}>
        {value ?? '—'}
      </span>
    </motion.div>
  )
}

function Result({
  score,
  best,
  bests,
  beaten,
  unit,
  isRecord,
  onAgain,
  onExit,
}: {
  score: number
  best: number | null
  bests: Record<WindowName, number | null>
  beaten: WindowName[]
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
          ) : beaten.length ? (
            <motion.span
              key="window"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              className="chrome text-accent"
            >
              {beaten.includes('week') ? 'Best this week' : 'Best today'}
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

        <div className="mt-4 flex gap-2">
          {WINDOWS.map((w) => (
            <ScoreWindow
              key={w.key}
              label={w.label}
              value={bests[w.key]}
              tone={w.key}
              fresh={beaten.includes(w.key)}
            />
          ))}
        </div>

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
