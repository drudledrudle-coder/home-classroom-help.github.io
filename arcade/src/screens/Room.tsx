import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import type { GameId, RoomErrorCode } from '../../shared/protocol'
import { Button } from '../components/Button'
import { CodeChip } from '../components/CodeChip'
import { GameShell } from '../components/GameShell'
import { TopBar } from '../components/TopBar'
import { GAMES } from '../games/registry'
import { springScreen } from '../lib/motion'
import type { Transport } from '../net/types'
import { useMatch } from '../net/useMatch'
import { GamePicker } from './GamePicker'
import { ReadyGate } from './ReadyGate'
import { WaitingRoom } from './WaitingRoom'

const ERRORS: Record<RoomErrorCode, { title: string; body: string }> = {
  NO_ROOM: {
    title: 'No such room',
    body: 'That code has expired or was never in use. Codes last three hours.',
  },
  ROOM_FULL: {
    title: 'Room is full',
    body: 'Two players are already in there. Ask them for a fresh code.',
  },
  NOT_A_MEMBER: {
    title: 'Lost your seat',
    body: 'You were away long enough that the room gave your place away.',
  },
  CONFLICT: { title: 'Room is busy', body: 'Too many writes at once. Try again.' },
  BAD_REQUEST: { title: 'Something went wrong', body: 'The room rejected that request.' },
  TOO_BIG: { title: 'Something went wrong', body: 'That was too much data to send.' },
  SERVER: { title: 'Server trouble', body: 'The room service is not answering right now.' },
  // Never rendered: App sends the player back to the key screen instead.
  LOCKED: { title: 'Key needed', body: 'Your access has expired.' },
}

export function Room({
  transport,
  autoSelect,
  onExit,
  onSolo,
  onLocked,
}: {
  transport: Transport
  autoSelect?: GameId
  onExit: () => void
  onSolo: () => void
  onLocked: () => void
}) {
  const match = useMatch(transport, GAMES)

  // An expired token or a changed site key is not a room error to read — it is
  // a locked door, so hand it back to the app to re-gate.
  const locked = match.conn.phase === 'error' && match.conn.code === 'LOCKED'
  useEffect(() => {
    if (locked) onLocked()
  }, [locked, onLocked])

  // start() is idempotent, so a StrictMode double-invoke is harmless. The
  // transport is torn down by whoever created it, not here.
  useEffect(() => {
    transport.start()
  }, [transport])

  // Keep the room's code in the URL for as long as we are in it.
  //
  // A guest arrives at #CODE and so survives a refresh for free, but the host
  // never had the code in the URL at all — the server assigns it after the room
  // is created — so refreshing mid-game dropped them on the home screen while
  // their seat sat waiting. The two paths are now identical: whoever is in a
  // room has its code in the URL, and the reload rejoins with the same playerId
  // and replays the log. `goHome` still clears it, so leaving really leaves.
  const code = match.code
  const isBot = match.isBot
  useEffect(() => {
    if (isBot || !code) return
    if (window.location.hash === `#${code}`) return
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${code}`)
  }, [code, isBot])

  // Entering from a "play this game now" tap on the home screen.
  useEffect(() => {
    if (!autoSelect) return
    if (match.gameId || match.slot !== 'host') return
    if (match.conn.phase !== 'live') return
    match.selectGame(autoSelect)
  }, [autoSelect, match])

  const module = match.gameId ? GAMES[match.gameId] : null

  if (match.conn.phase === 'error') {
    const copy = ERRORS[match.conn.code]
    return (
      <Screen>
        <TopBar onBack={onExit} />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-10">
          <h2 className="display text-[2.25rem] leading-tight">{copy.title}</h2>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">{copy.body}</p>
          <div className="mt-7 flex flex-col gap-2.5">
            <Button full onClick={onExit}>
              Back to the start
            </Button>
            <Button full variant="secondary" onClick={onSolo}>
              Play the bot instead
            </Button>
          </div>
        </div>
      </Screen>
    )
  }

  if (match.conn.phase === 'connecting') {
    return (
      <Screen>
        <TopBar onBack={onExit} />
        <div className="flex flex-1 items-center justify-center">
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="chrome text-muted"
          >
            Connecting
          </motion.span>
        </div>
      </Screen>
    )
  }

  const showWaiting = !match.isBot && !match.opponentPresent && !match.started

  return (
    <Screen>
      <TopBar
        onBack={onExit}
        center={match.isBot ? <BotBadge /> : <CodeChip code={match.code} />}
      />

      {match.conn.phase === 'reconnecting' ? <ReconnectingBar /> : null}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={showWaiting ? 'waiting' : !module ? 'picker' : !match.started ? 'ready' : 'play'}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={springScreen}
          className="flex min-h-0 flex-1 flex-col"
        >
          {showWaiting ? (
            <WaitingRoom code={match.code} onSolo={onSolo} />
          ) : !module ? (
            <GamePicker onPick={match.selectGame} isBot={match.isBot} />
          ) : !match.started ? (
            <ReadyGate
              module={module}
              ready={match.ready}
              slot={match.slot}
              isBot={match.isBot}
              onReady={match.markReady}
              onBack={match.leaveGame}
            />
          ) : (
            <GameShell match={match} module={module} onExit={match.leaveGame} />
          )}
        </motion.div>
      </AnimatePresence>
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[100dvh] flex-col overflow-hidden">{children}</div>
}

function BotBadge() {
  return (
    <span className="chrome rounded-lg border border-line bg-surface px-2.5 py-1.5 text-muted">
      Solo vs bot
    </span>
  )
}

/** Requests are failing but the room is presumed intact — say so, quietly. */
function ReconnectingBar() {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="bg-accent-wash"
    >
      <div className="flex items-center justify-center gap-2 py-1.5">
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          className="block h-1.5 w-1.5 rounded-full bg-accent"
        />
        <span className="chrome text-accent">Reconnecting</span>
      </div>
    </motion.div>
  )
}
