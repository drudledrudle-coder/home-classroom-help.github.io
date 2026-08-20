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

function RecallPlay({ api, running }: { api: SoloApi; running: boolean }) {
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

  // One append per round, however many times the effect below re-runs. Pausing
  // toggles `running`, and without this latch every resume would quietly add
  // another pad to the sequence — the run would get harder for pausing.
  const dealt = useRef(0)
  // Read inside the effect without making it a dependency, so answering a pad
  // never reschedules the playback.
  const phaseRef = useRef<Phase>('watch')
  phaseRef.current = phase

  // Appends one pad and plays the whole sequence back. Scheduled up front
  // rather than chained, so a slow frame cannot drift the lights off the beat.
  useEffect(() => {
    if (dead.current) return
    // The whole game is watch-then-repeat, so playing the sequence out behind
    // the countdown — or behind the pause sheet — would show the player
    // something they cannot answer, and the first round is the one they would
    // miss.
    if (!running) {
      clearTimers()
      setLit(null)
      return
    }

    const fresh = dealt.current !== roundNo
    if (fresh) {
      dealt.current = roundNo
      sequence.current = [...sequence.current, Math.floor(Math.random() * PADS)]
      setLength(sequence.current.length)
    }

    // Resuming part-way through answering picks up where it stopped. Only the
    // watch phase replays, and only because the sheet covered the board while
    // it was up: a player who paused mid-flash saw nothing, so replaying is
    // what makes the pause fair rather than a punishment. It is the same
    // sequence rather than a new one, so the most a pause can ever buy is a
    // second look at a pattern already shown.
    if (!fresh && phaseRef.current === 'repeat') return

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
    // `running` belongs here: the first round bails out during the countdown,
    // and without it in the deps the effect would never run again and the game
    // would simply never start.
  }, [roundNo, running, clearTimers, sound])

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

  // 1-4 mirror the pads, reading left to right, top to bottom.
  useEffect(() => {
    if (phase !== 'repeat') return
    const onKey = (event: KeyboardEvent) => {
      const pad = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code)
      if (pad < 0 || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      press(pad)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, press])

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
            onPress={() => press(i)}
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
        Watch, then repeat. Tap the pads or press 1–4.
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
