import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NAME_MAX, NAME_MIN } from '../../shared/scores'
import type { ScoreErrorCode } from '../../shared/scores'
import { Button } from '../components/Button'
import { TopBar } from '../components/TopBar'
import { spring, springSnap } from '../lib/motion'
import { useSound } from '../lib/sound'
import { announceAccount, claimName, currentUser, signIn } from '../net/account'

/**
 * The login, and the one-time name.
 *
 * Two steps, deliberately shown as two screens rather than two fields. The name
 * is permanent, and putting it beside the key would invite someone to fill both
 * in without reading — which is exactly the mistake that cannot be undone
 * without an admin.
 */

const MESSAGES: Partial<Record<ScoreErrorCode, string>> = {
  BAD_KEY: 'That key is not one of ours.',
  BAD_TOKEN: 'Signed out — enter your key again.',
  BAD_NAME: `Letters and numbers, ${NAME_MIN}–${NAME_MAX} characters.`,
  NAME_TAKEN: 'Somebody already has that name.',
  NAME_SET: 'Your name is already set.',
  DISABLED: 'This arcade has no keys set up yet.',
  CONFLICT: 'Could not reach the server. Check your connection.',
}

export function Gate({ onReady }: { onReady: () => void }) {
  // Someone signed in but unnamed — an interrupted first run, or a name claimed
  // on another device — lands straight on the second step.
  const [named, setNamed] = useState(() => currentUser())

  if (named && !named.name && !named.admin) {
    return <ClaimName onDone={onReady} />
  }

  return <EnterKey onSignedIn={(needsName) => (needsName ? setNamed(currentUser()) : onReady())} />
}

/* -------------------------------------------------------------------------- */

function EnterKey({ onSignedIn }: { onSignedIn: (needsName: boolean) => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ScoreErrorCode | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sound = useSound()

  useEffect(() => {
    // Desktop only: focusing on a phone would throw the keyboard up over the
    // whole screen before the player has read anything.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 3_200)
    return () => clearTimeout(id)
  }, [error])

  const submit = useCallback(async () => {
    const key = value.trim()
    if (!key || busy) return
    setBusy(true)
    const res = await signIn(key)
    setBusy(false)

    if (!res.ok) {
      sound.play('foul')
      setError(res.error)
      setValue('')
      inputRef.current?.focus()
      return
    }

    sound.play('confirm')
    announceAccount()
    onSignedIn(!res.me.name && !res.me.admin)
  }, [value, busy, onSignedIn, sound])

  return (
    <Frame
      eyebrow="Sign in"
      title="Your key"
      blurb="Your key is your account. Everything you play goes on the boards under the name you pick next."
      error={error ? (MESSAGES[error] ?? 'That did not work.') : null}
      shake={error !== null}
      onSubmit={submit}
    >
      <input
        ref={inputRef}
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
        autoComplete="current-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Your key"
        placeholder="••••••••"
        className="h-15 w-full rounded-xl border bg-surface px-4 text-[16px] tracking-[0.08em] text-ink outline-none placeholder:text-muted/40"
        style={{ borderColor: error ? 'var(--t-accent)' : 'var(--t-line-strong)' }}
      />
      <Button type="submit" size="lg" full disabled={!value.trim() || busy}>
        {busy ? 'Checking…' : 'Enter'}
      </Button>
    </Frame>
  )
}

/* -------------------------------------------------------------------------- */

function ClaimName({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ScoreErrorCode | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sound = useSound()

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 3_200)
    return () => clearTimeout(id)
  }, [error])

  const submit = useCallback(async () => {
    const name = value.trim()
    if (name.length < NAME_MIN || busy) return
    setBusy(true)
    const res = await claimName(name)
    setBusy(false)

    if (!res.ok) {
      sound.play('foul')
      setError(res.error)
      inputRef.current?.focus()
      return
    }

    sound.play('win')
    announceAccount()
    onDone()
  }, [value, busy, onDone, sound])

  return (
    <Frame
      eyebrow="One time only"
      title="Pick your name"
      blurb="This is how you appear on every board, and it cannot be changed afterwards. Choose one you will still want in a month."
      error={error ? (MESSAGES[error] ?? 'That did not work.') : null}
      shake={error !== null}
      onSubmit={submit}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
        maxLength={NAME_MAX}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Your leaderboard name"
        placeholder="Name"
        className="h-15 w-full rounded-xl border bg-surface px-4 text-[16px] text-ink outline-none placeholder:text-muted/40"
        style={{ borderColor: error ? 'var(--t-accent)' : 'var(--t-line-strong)' }}
      />
      <Button type="submit" size="lg" full disabled={value.trim().length < NAME_MIN || busy}>
        {busy ? 'Claiming…' : 'This is me'}
      </Button>
    </Frame>
  )
}

/* -------------------------------------------------------------------------- */

function Frame({
  eyebrow,
  title,
  blurb,
  error,
  shake,
  onSubmit,
  children,
}: {
  eyebrow: string
  title: string
  blurb: string
  error: string | null
  shake: boolean
  onSubmit: () => Promise<void>
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopBar />

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 pb-24">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <span className="chrome text-muted">{eyebrow}</span>
          <h1 className="display mt-2.5 text-[2.5rem] leading-[0.95]">{title}</h1>
          <p className="pt-3 text-[0.9375rem] leading-snug text-muted">{blurb}</p>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.07 }}
          onSubmit={(e) => {
            e.preventDefault()
            void onSubmit()
          }}
          className="mt-8"
        >
          <motion.div
            animate={shake ? { x: [0, -8, 7, -4, 0] } : { x: 0 }}
            transition={{ duration: 0.34 }}
            className="flex flex-col gap-3"
          >
            {children}
          </motion.div>
        </motion.form>

        <div className="flex min-h-9 items-start pt-2">
          <AnimatePresence mode="wait" initial={false}>
            {error ? (
              <motion.span
                key={error}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={springSnap}
                role="alert"
                className="text-[0.8125rem] text-accent"
              >
                {error}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
