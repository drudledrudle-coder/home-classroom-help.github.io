import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useState } from 'react'
import { LEADERBOARD_GAMES, NAME_MAX } from '../../shared/scores'
import type { Boards, Entry, ScoreErrorCode } from '../../shared/scores'
import { Button } from '../components/Button'
import { Press } from '../components/Press'
import { TopBar } from '../components/TopBar'
import { SOLO_GAMES } from '../games/solo/registry'
import type { SoloId } from '../games/solo/types'
import { spring, springSnap, stagger } from '../lib/motion'
import { useSound } from '../lib/sound'
import {
  announceAccount,
  claimName,
  signIn,
  signOut,
  useBoards,
  useMe,
} from '../net/account'

const MESSAGES: Partial<Record<ScoreErrorCode, string>> = {
  BAD_KEY: 'That key is not one of ours.',
  BAD_TOKEN: 'Signed out — sign in again.',
  BAD_NAME: `Letters and numbers, ${NAME_MAX} characters or fewer.`,
  NAME_TAKEN: 'Somebody already has that name.',
  NAME_SET: 'Your name is already set.',
  NOT_ADMIN: 'Only an admin can do that.',
  DISABLED: 'No sign-in keys are set up yet.',
  CONFLICT: 'Could not reach the leaderboard.',
}

export function Leaderboard({ onExit }: { onExit: () => void }) {
  const me = useMe()
  const { boards, loading, apply } = useBoards()

  return (
    <div className="relative flex min-h-[100dvh] flex-col">
      <TopBar onBack={onExit} center={<span className="display text-[1.0625rem]">Leaderboard</span>} />

      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-5 pt-8 pb-16 sm:px-8">
        <Identity me={me} onBoards={apply} />

        <Champions boards={boards} loading={loading} meUid={me?.uid} />

        <div className="mt-10 flex flex-col gap-9">
          {LEADERBOARD_GAMES.map((id, i) => (
            <GameBoard
              key={id}
              id={id as SoloId}
              rows={boards?.games[id] ?? []}
              index={i}
              meUid={me?.uid}
            />
          ))}
        </div>

        <p className="pt-12 text-center text-[0.8125rem] text-muted/70">
          Scores are posted by the app on your phone, so this runs on trust —
          which is the right trade for a board you share with friends.
        </p>
      </main>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/** Sign in, claim a name once, or see who you are. */
function Identity({ me, onBoards }: { me: ReturnType<typeof useMe>; onBoards: (b: Boards) => void }) {
  const sound = useSound()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ScoreErrorCode | null>(null)

  const doSignIn = useCallback(async () => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError(null)
    const res = await signIn(key)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      sound.play('foul')
      return
    }
    setKey('')
    onBoards(res.boards)
    announceAccount()
    sound.play('confirm')
  }, [key, busy, onBoards, sound])

  const doClaim = useCallback(async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    const res = await claimName(name)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      sound.play('foul')
      return
    }
    setName('')
    onBoards(res.boards)
    announceAccount()
    sound.play('win')
  }, [name, busy, onBoards, sound])

  const message = error ? (MESSAGES[error] ?? 'That did not work.') : null

  if (me?.name) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <span className="chrome text-muted/70">Signed in as</span>
            <p className="display truncate text-[1.5rem] leading-tight">{me.name}</p>
          </div>
          <Press
            cue="tap"
            depth={0.94}
            onPress={() => {
              signOut()
              announceAccount()
            }}
            className="shrink-0 rounded-lg px-3 py-2"
          >
            <span className="chrome text-muted">Sign out</span>
          </Press>
        </div>
        {me.admin ? (
          <p className="chrome pt-2 text-accent">Admin — you can rename anyone</p>
        ) : null}
      </section>
    )
  }

  // Signed in but unnamed: the one-time claim.
  if (me) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-4">
        <span className="chrome text-muted/70">Pick your name</span>
        <p className="pt-1 pb-3 text-sm text-muted">
          This is permanent — it is how you appear on every board from now on.
        </p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void doClaim()}
            maxLength={NAME_MAX}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Your leaderboard name"
            placeholder="Name"
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2.5 text-[16px] text-ink outline-none focus:border-accent"
          />
          <Button onClick={doClaim} disabled={busy || name.trim().length < 2}>
            Claim
          </Button>
        </div>
        <Message text={message} />
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <span className="chrome text-muted/70">Sign in to appear</span>
      <p className="pt-1 pb-3 text-sm text-muted">
        Enter your key. You can still read the boards without one.
      </p>
      <div className="flex gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void doSignIn()}
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Your key"
          placeholder="Key"
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2.5 text-[16px] text-ink outline-none focus:border-accent"
        />
        <Button onClick={doSignIn} disabled={busy || !key.trim()}>
          Sign in
        </Button>
      </div>
      <Message text={message} />
    </section>
  )
}

function Message({ text }: { text: string | null }) {
  return (
    <AnimatePresence>
      {text ? (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={springSnap}
          role="alert"
          className="pt-2.5 text-[0.8125rem]"
          style={{ color: 'var(--t-danger)' }}
        >
          {text}
        </motion.p>
      ) : null}
    </AnimatePresence>
  )
}

/** Who holds the most firsts. The board about the boards. */
function Champions({
  boards,
  loading,
  meUid,
}: {
  boards: Boards | null
  loading: boolean
  meUid?: string
}) {
  const rows = boards?.champions ?? []

  return (
    <section className="pt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="display text-[1.75rem] leading-none">Champions</h2>
        <span className="chrome text-muted/60">First places</span>
      </div>

      {loading ? (
        <p className="pt-4 text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="pt-4 text-sm text-muted">
          Nobody has posted a score yet. The first person to finish a run takes
          every crown at once.
        </p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {rows.map((c, i) => (
            <motion.li
              key={c.uid}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(i, 0.05)}
              className="flex items-baseline gap-4 border-b border-line py-3.5"
              style={c.uid === meUid ? { color: 'var(--t-accent)' } : undefined}
            >
              <span className="chrome tnum w-6 shrink-0 text-muted/50">{i + 1}</span>
              <span className="display min-w-0 flex-1 truncate text-[1.25rem] leading-none">
                {c.name}
              </span>
              <span className="chrome tnum shrink-0">
                {c.firsts} {c.firsts === 1 ? 'crown' : 'crowns'}
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GameBoard({
  id,
  rows,
  index,
  meUid,
}: {
  id: SoloId
  rows: Entry[]
  index: number
  meUid?: string
}) {
  const meta = SOLO_GAMES[id]?.meta
  const [open, setOpen] = useState(false)
  // Long boards are collapsed: the point of a leaderboard on a phone is the
  // top of it, and ten rows of scrolling between games buries the next one.
  const shown = open ? rows : rows.slice(0, 5)

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={stagger(index, 0.05)}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="display text-[1.5rem] leading-none">{meta?.title ?? id}</h3>
        <span className="chrome text-muted/60">{meta?.unit ?? ''}</span>
      </div>

      {rows.length === 0 ? (
        <p className="pt-3 text-sm text-muted">No scores yet.</p>
      ) : (
        <>
          <ul className="mt-3 border-t border-line">
            {shown.map((e, i) => (
              <li
                key={e.uid}
                className="flex items-baseline gap-4 border-b border-line py-3"
                style={e.uid === meUid ? { color: 'var(--t-accent)' } : undefined}
              >
                <span className="chrome tnum w-6 shrink-0 text-muted/50">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[1rem]">{e.name}</span>
                <motion.span
                  animate={{ scale: i === 0 ? 1 : 0.94 }}
                  transition={spring}
                  className="display tnum shrink-0 text-[1.25rem] leading-none"
                >
                  {e.score}
                </motion.span>
              </li>
            ))}
          </ul>

          {rows.length > 5 ? (
            <Press
              cue="tap"
              depth={0.98}
              onPress={() => setOpen((v) => !v)}
              className="mt-2 rounded-lg py-2"
            >
              <span className="chrome text-muted">
                {open ? 'Show less' : `Show all ${rows.length}`}
              </span>
            </Press>
          ) : null}
        </>
      )}
    </motion.section>
  )
}
