import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Press } from '../../../components/Press'
import { springSnap } from '../../../lib/motion'
import { useSound } from '../../../lib/sound'
import type { SoloApi, SoloModule } from '../types'

const PADS = 4
const SHOW_MS = 460
const GAP_MS = 170
const LEAD_IN_MS = 620

type Phase = 'watch' | 'repeat'

function RecallPlay({ api }: { api: SoloApi }) {
  const sound = useSound()
  /** Rounds drive everything; the sequence is grown once per round. */
  const [roundNo, setRoundNo] = useState(1)
  const [length, setLength] = useState(0)
  const [lit, setLit] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('watch')

  const sequence = useRef<number[]>([])
  const step = useRef(0)
  const dead = useRef(false)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  // Appends one pad and plays the whole sequence back. Scheduled up front
  // rather than chained, so a slow frame cannot drift the lights off the beat.
  useEffect(() => {
    if (dead.current) return

    sequence.current = [...sequence.current, Math.floor(Math.random() * PADS)]
    setLength(sequence.current.length)
    setPhase('watch')
    step.current = 0
    clearTimers()

    sequence.current.forEach((pad, i) => {
      const at = LEAD_IN_MS + i * (SHOW_MS + GAP_MS)
      timers.current.push(
        setTimeout(() => {
          setLit(pad)
          sound.play('tick')
        }, at),
      )
      timers.current.push(setTimeout(() => setLit(null), at + SHOW_MS))
    })

    timers.current.push(
      setTimeout(
        () => setPhase('repeat'),
        LEAD_IN_MS + sequence.current.length * (SHOW_MS + GAP_MS),
      ),
    )
  }, [roundNo, clearTimers, sound])

  const press = useCallback(
    (pad: number) => {
      if (phase !== 'repeat' || dead.current) return

      if (sequence.current[step.current] !== pad) {
        dead.current = true
        clearTimers()
        sound.play('foul')
        setLit(null)
        setTimeout(() => api.end(), 320)
        return
      }

      sound.play('tap')
      setLit(pad)
      timers.current.push(setTimeout(() => setLit(null), 130))
      step.current += 1

      if (step.current === sequence.current.length) {
        api.setScore(sequence.current.length)
        setPhase('watch')
        timers.current.push(setTimeout(() => setRoundNo((n) => n + 1), 520))
      }
    },
    [phase, api, sound, clearTimers],
  )

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-3 sm:px-6">
      <div className="flex items-baseline justify-between pb-3">
        <span className="chrome text-muted">Round {length}</span>
        <motion.span
          key={phase}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSnap}
          className="chrome"
          style={{ color: phase === 'repeat' ? 'var(--t-accent)' : 'var(--t-muted)' }}
        >
          {phase === 'repeat' ? 'Your turn' : 'Watch'}
        </motion.span>
      </div>

      <div
        className="grid aspect-square w-full grid-cols-2 gap-2.5"
        style={{ maxWidth: 'min(100%, calc(100dvh - 16rem))' }}
      >
        {Array.from({ length: PADS }, (_, i) => (
          <Press
            key={i}
            cue={null}
            depth={phase === 'repeat' ? 0.95 : 1}
            disabled={phase !== 'repeat'}
            aria-label={`Pad ${i + 1}`}
            onClick={() => press(i)}
            className="rounded-2xl border disabled:pointer-events-none"
            style={{
              borderColor: lit === i ? 'var(--t-accent)' : 'var(--t-line)',
              backgroundColor:
                lit === i
                  ? 'var(--t-accent)'
                  : `color-mix(in srgb, var(--t-accent) ${6 + i * 3}%, var(--t-surface))`,
              transition: 'background-color 90ms linear, border-color 90ms linear',
            }}
          />
        ))}
      </div>

      <p className="pt-4 text-center text-[0.8125rem] text-muted short:hidden">
        Watch the sequence, then repeat it. It grows by one every round.
      </p>
    </div>
  )
}

export const recallGame: SoloModule = {
  meta: {
    id: 'recall',
    title: 'Recall',
    rule: 'Watch the sequence of pads light up, then repeat it — it grows by one every round.',
    direction: 'high',
    unit: 'rounds',
  },
  Play: RecallPlay,
}
