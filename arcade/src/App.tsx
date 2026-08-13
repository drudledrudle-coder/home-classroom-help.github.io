import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameId } from '../shared/protocol'
import { normalizeCode } from '../shared/protocol'
import { CursorField } from './components/CursorField'
import { botFor } from './games/registry'
import { createBotTransport } from './net/botTransport'
import { gateRequired, gateToken } from './net/gate'
import { createOnlineTransport } from './net/onlineTransport'
import type { Transport } from './net/types'
import { Gate } from './screens/Gate'
import { Home } from './screens/Home'
import { Room } from './screens/Room'

type Route = { name: 'home' } | { name: 'room'; transport: Transport; autoSelect?: GameId }
type GateState = 'checking' | 'locked' | 'open'

/** A shared link looks like https://host/#WXYZ. */
function codeFromHash(): string {
  return normalizeCode(window.location.hash.replace('#', '')) ?? ''
}

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [initialCode] = useState(codeFromHash)

  // Holding a token already means we can paint immediately and confirm in the
  // background — only a first visit waits on the check.
  const [gate, setGate] = useState<GateState>(() => (gateToken() ? 'open' : 'checking'))

  useEffect(() => {
    let alive = true
    void gateRequired().then((required) => {
      if (!alive) return
      if (!required) setGate('open')
      else setGate(gateToken() ? 'open' : 'locked')
    })
    return () => {
      alive = false
    }
  }, [])

  // Transports own a polling loop and a seat in a room, so their lifecycle is
  // managed here explicitly rather than by an effect that React may re-run.
  const active = useRef<Transport | null>(null)

  const enter = useCallback((transport: Transport, autoSelect?: GameId) => {
    active.current?.stop()
    active.current = transport
    setRoute({ name: 'room', transport, autoSelect })
  }, [])

  const goHome = useCallback(() => {
    active.current?.stop()
    active.current = null
    // Drop the code from the URL so a refresh does not rejoin a room we left.
    history.replaceState(null, '', window.location.pathname + window.location.search)
    setRoute({ name: 'home' })
  }, [])

  /** The token expired or the key was changed; send them back to the door. */
  const relock = useCallback(() => {
    goHome()
    setGate('locked')
  }, [goHome])

  const createRoom = useCallback(() => enter(createOnlineTransport({ mode: 'create' })), [enter])

  const joinRoom = useCallback(
    (code: string) => enter(createOnlineTransport({ mode: 'join', code })),
    [enter],
  )

  const playSolo = useCallback((game?: GameId) => enter(createBotTransport(botFor), game), [enter])

  // Landing on a shared link goes straight into the room, but never before the
  // key has been cleared.
  const autoJoined = useRef(false)
  useEffect(() => {
    if (gate !== 'open' || autoJoined.current || !initialCode) return
    autoJoined.current = true
    joinRoom(initialCode)
  }, [gate, initialCode, joinRoom])

  // Deliberately no `pagehide` teardown.
  //
  // Releasing the seat on unload looks tidy but breaks refresh-mid-game: the
  // leave is sent with the same playerId the reloaded page is about to rejoin
  // with, and if it lands after that rejoin it clears the seat the new page
  // just claimed — the player then bounces through "lost your seat" instead of
  // dropping straight back into the board. Presence already expires a few
  // seconds after a tab really goes away, which is the case this would have
  // optimised. Leaving on purpose (the back button) still calls stop().

  // Blank rather than a spinner: the check is one request, and a flash of the
  // home screen before the key screen would be worse than a beat of nothing.
  if (gate === 'checking') return <div className="min-h-[100dvh] bg-bg" />

  if (gate === 'locked') return <Gate onUnlocked={() => setGate('open')} />

  return (
    <>
      <CursorField />
      {/* No AnimatePresence around the route swap. With `mode="wait"` the new
          screen is not mounted until the old one has finished exiting, which
          means the room's connect effect is held behind an animation — a
          refresh straight into a room could sit on the home screen instead of
          rejoining. Both screens already animate their own contents in, so the
          wrapper bought nothing. */}
      <div key={route.name} className="relative z-10">
        {route.name === 'home' ? (
          <Home
            onCreate={createRoom}
            onJoin={joinRoom}
            onSolo={playSolo}
            initialCode={initialCode}
          />
        ) : (
          <Room
            transport={route.transport}
            autoSelect={route.autoSelect}
            onExit={goHome}
            onSolo={() => playSolo()}
            onLocked={relock}
          />
        )}
      </div>
    </>
  )
}
