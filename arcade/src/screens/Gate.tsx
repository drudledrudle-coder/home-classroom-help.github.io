import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { TopBar } from '../components/TopBar'
import { spring, springSnap } from '../lib/motion'
import { useSound } from '../lib/sound'
import { unlock } from '../net/gate'

/**
 * Shown only when the deployment has ARCADE_KEY set. The key is posted to the
 * function and checked there; nothing about it exists on the client.
 */
export function Gate({ onUnlocked }: { onUnlocked: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<'wrong' | 'offline' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sound = useSound()

  useEffect(() => {
    // Desktop only: focusing on a phone would throw the keyboard up over the
    // whole screen before the player has read anything.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!problem) return
    const id = setTimeout(() => setProblem(null), 2_200)
    return () => clearTimeout(id)
  }, [problem])

  const submit = useCallback(async () => {
    const key = value.trim()
    if (!key || busy) return
    setBusy(true)
    const result = await unlock(key)
    setBusy(false)

    if (result === 'ok') {
      sound.play('confirm')
      onUnlocked()
      return
    }
    sound.play('foul')
    setProblem(result)
    setValue('')
    inputRef.current?.focus()
  }, [value, busy, onUnlocked, sound])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopBar />

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          <span className="chrome text-muted">Private</span>
          <h1 className="display mt-2.5 text-[2.5rem] leading-[0.95]">Key required</h1>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.07 }}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="mt-8"
        >
          <motion.div animate={problem ? { x: [0, -8, 7, -4, 0] } : { x: 0 }} transition={{ duration: 0.34 }}>
            <input
              ref={inputRef}
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
              autoComplete="current-password"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Access key"
              placeholder="••••••••"
              className="h-15 w-full rounded-xl border bg-surface px-4 text-[1.0625rem] tracking-[0.08em] outline-none placeholder:text-muted/40"
              style={{ borderColor: problem ? 'var(--t-accent)' : 'var(--t-line-strong)' }}
            />
          </motion.div>

          <div className="flex h-7 items-center">
            <AnimatePresence mode="wait" initial={false}>
              {problem ? (
                <motion.span
                  key={problem}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={springSnap}
                  className="chrome text-accent"
                >
                  {problem === 'wrong' ? 'Not the key' : 'Could not reach the server'}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>

          <Button type="submit" size="lg" full disabled={!value.trim() || busy}>
            {busy ? 'Checking…' : 'Enter'}
          </Button>
        </motion.form>
      </main>
    </div>
  )
}
