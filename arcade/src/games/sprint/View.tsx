import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { OTHER } from '../../../shared/protocol'
import { Press } from '../../components/Press'
import { spring, springSnap } from '../../lib/motion'
import { useSound } from '../../lib/sound'
import type { GameViewProps } from '../types'
import { scoreOf } from './dictionary'
import { EV_WORD, checkWord } from './logic'
import type { Rejection, SprintState } from './logic'

const REASONS: Record<NonNullable<Rejection>, string> = {
  short: 'Three letters minimum',
  letters: 'Not in your rack',
  duplicate: 'Already found',
  unknown: 'Not a word',
}

export function SprintView({ state, ctx, send }: GameViewProps<SprintState>) {
  const { slot } = ctx
  const sound = useSound()
  const [picks, setPicks] = useState<number[]>([])
  const [reject, setReject] = useState<NonNullable<Rejection> | null>(null)

  const mine = state.found[slot]
  const theirCount = state.found[OTHER[slot]].length
  const word = picks.map((i) => state.letters[i]).join('')
  const live = state.phase === 'playing'

  const clear = useCallback(() => setPicks([]), [])

  const submit = useCallback(() => {
    if (!live || !word) return
    const problem = checkWord(word, state.letters, mine)
    if (problem) {
      setReject(problem)
      sound.play('foul')
      setPicks([])
      return
    }
    send(EV_WORD, { w: word })
    sound.play('confirm')
    setPicks([])
  }, [live, word, state.letters, mine, send, sound])

  const pushLetter = useCallback(
    (index: number) => {
      if (!live || picks.includes(index)) return
      sound.play('tap')
      setPicks((prev) => [...prev, index])
    },
    [live, picks, sound],
  )

  useEffect(() => {
    if (!reject) return
    const id = setTimeout(() => setReject(null), 1_300)
    return () => clearTimeout(id)
  }, [reject])

  // Physical keyboard on desktop. The tiles remain the primary input, since a
  // mobile keyboard would cover half the board.
  useEffect(() => {
    if (!live) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
        return
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        setPicks((prev) => prev.slice(0, -1))
        return
      }
      const ch = e.key.toLowerCase()
      if (!/^[a-z]$/.test(ch)) return
      setPicks((prev) => {
        const free = state.letters.findIndex((l, i) => l === ch && !prev.includes(i))
        return free < 0 ? prev : [...prev, free]
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live, state.letters, submit])

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pt-3 sm:px-6">
      {/* Found words take the scrollable space so the rack never moves. */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <div className="flex items-baseline justify-between pb-2">
          <span className="chrome text-muted">Your words · {mine.length}</span>
          <span className="chrome text-muted/70">Them · {theirCount}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {mine
              .slice()
              .reverse()
              .map((w) => (
                <motion.span
                  key={w}
                  layout
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={springSnap}
                  className="flex items-baseline gap-1.5 rounded-lg border border-line bg-surface px-2 py-1"
                >
                  <span className="text-[0.8125rem] tracking-tight">{w}</span>
                  <span className="chrome text-accent">{scoreOf(w)}</span>
                </motion.span>
              ))}
          </AnimatePresence>
          {!mine.length ? (
            <span className="text-[0.8125rem] text-muted">Tap letters to build a word.</span>
          ) : null}
        </div>
      </div>

      {/* Staging line: the word under construction, plus why one was refused. */}
      <motion.div
        animate={reject ? { x: [0, -7, 6, -4, 0] } : { x: 0 }}
        transition={{ duration: 0.32 }}
        className="flex h-16 flex-col items-center justify-center"
      >
        <AnimatePresence mode="wait" initial={false}>
          {reject ? (
            <motion.span
              key={reject}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={springSnap}
              className="chrome text-accent"
            >
              {REASONS[reject]}
            </motion.span>
          ) : (
            <motion.span
              key="word"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="display text-[2.25rem] tracking-[0.02em] uppercase"
            >
              {word || <span className="text-muted/30">—</span>}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="safe-b pt-1">
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {state.letters.map((letter, i) => {
            const used = picks.includes(i)
            return (
              <Press
                key={i}
                cue={null}
                depth={0.9}
                disabled={!live || used}
                onClick={() => pushLetter(i)}
                aria-label={`Letter ${letter}`}
                className="relative grid aspect-square place-items-center rounded-xl border disabled:pointer-events-none"
                style={{
                  borderColor: used ? 'var(--t-line)' : 'var(--t-line-strong)',
                  backgroundColor: used ? 'transparent' : 'var(--t-surface)',
                }}
              >
                <motion.span
                  animate={{ opacity: used ? 0.18 : 1, scale: used ? 0.85 : 1 }}
                  transition={spring}
                  className="display text-[1.375rem] uppercase sm:text-[1.5rem]"
                >
                  {letter}
                </motion.span>
              </Press>
            )
          })}
        </div>

        <div className="mt-2.5 flex gap-2">
          <Press
            cue="tap"
            onClick={() => setPicks((prev) => prev.slice(0, -1))}
            disabled={!picks.length}
            className="h-13 flex-1 rounded-xl border border-line-strong bg-surface disabled:opacity-40"
          >
            <span className="chrome">Undo</span>
          </Press>
          <Press
            cue="tap"
            onClick={clear}
            disabled={!picks.length}
            className="h-13 flex-1 rounded-xl border border-line-strong bg-surface disabled:opacity-40"
          >
            <span className="chrome">Clear</span>
          </Press>
          <Press
            cue={null}
            onClick={submit}
            disabled={!picks.length}
            className="h-13 flex-[1.6] rounded-xl bg-accent text-accent-ink disabled:opacity-40"
          >
            <span className="chrome">Enter</span>
          </Press>
        </div>
      </div>
    </div>
  )
}
