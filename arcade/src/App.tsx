import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameId } from '../shared/protocol'
import { normalizeCode } from '../shared/protocol'
import { botFor } from './games/registry'
import { springScreen } from './lib/motion'
import { createBotTransport } from './net/botTransport'
import { createOnlineTransport } from './net/onlineTransport'
import type { Transport } from './net/types'
import { Home } from './screens/Home'
import { Room } from './screens/Room'

type Route =
  | { name: 'home' }
  | { name: 'room'; transport: Transport; autoSelect?: GameId }

/** A shared link looks like https://host/#WXYZ. */
function codeFromHash(): string {
  return normalizeCode(window.location.hash.replace('#', '')) ?? ''
}

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [initialCode] = useState(codeFromHash)

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

  const createRoom = useCallback(
    () => enter(createOnlineTransport({ mode: 'create' })),
    [enter],
  )

  const joinRoom = useCallback(
    (code: string) => enter(createOnlineTransport({ mode: 'join', code })),
    [enter],
  )

  const playSolo = useCallback(
    (game?: GameId) => enter(createBotTransport(botFor), game),
    [enter],
  )

  // Landing on a shared link goes straight into the room; being told "join
  // failed, the room is full" is more useful than a prefilled box.
  const autoJoined = useRef(false)
  useEffect(() => {
    if (autoJoined.current || !initialCode) return
    autoJoined.current = true
    joinRoom(initialCode)
  }, [initialCode, joinRoom])

  // Release the seat on tab close instead of making the opponent wait out the
  // presence timeout.
  useEffect(() => {
    const onHide = () => active.current?.stop()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={route.name === 'home' ? 'home' : 'room'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={springScreen}
      >
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
          />
        )}
      </motion.div>
    </AnimatePresence>
  )
}
