import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { GameId, PeerState, Slot } from '../../shared/protocol'
import { OTHER, PRESENCE_TIMEOUT_MS } from '../../shared/protocol'
import type { AnyGameModule, BaseGameState, GameClock, GameCtx } from '../games/types'
import { makeSeed } from '../lib/random'
import { COUNTDOWN_MS, EV_GAME, EV_READY, EV_START, EV_TIMEUP, readShellState } from './shellState'
import type { ConnState, NetStats, Transport } from './types'

export type MatchApi = {
  conn: ConnState
  stats: NetStats
  code: string
  slot: Slot
  isBot: boolean
  peers: Record<Slot, PeerState>
  opponentPresent: boolean
  gameId: GameId | null
  ready: Record<Slot, boolean>
  started: boolean
  ctx: GameCtx
  clock: GameClock
  state: BaseGameState | null
  send: (type: string, data?: unknown) => void
  selectGame: (id: GameId) => void
  markReady: () => void
  rematch: () => void
  leaveGame: () => void
}

export function useMatch(transport: Transport, modules: Record<GameId, AnyGameModule>): MatchApi {
  const snapshot = useSyncExternalStore(
    useCallback((fn) => transport.subscribe(fn), [transport]),
    useCallback(() => transport.getState(), [transport]),
  )

  // Presence must decay on a wall clock, not only when a sync lands — a dead
  // network produces no syncs, and that is exactly when we need to notice.
  const [, forcePresenceCheck] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forcePresenceCheck((n) => n + 1), 1_000)
    return () => clearInterval(id)
  }, [])

  const { events, pending, peers, slot, clockOffset, stats } = snapshot

  /** Confirmed log plus unacknowledged local events, in order. */
  const log = useMemo(
    () => (pending.length ? [...events, ...pending] : events),
    [events, pending],
  )

  const shell = useMemo(() => readShellState(log), [log])
  const { gameId, seed, startedAt, ready, startIndex } = shell

  const module = gameId ? modules[gameId] : null

  // `startedAt` handed to games is when *play* begins, not when the match record
  // was stamped — the same meaning bots get. Grab's reducer judges whether a
  // claim landed inside a dot's lifetime by subtracting this from the event
  // time, and its view schedules those dots on `clock.elapsed()`; if the two
  // disagreed by the countdown, every claim in the game was rejected as late.
  // Defining it once here keeps any future game on the same clock for free.
  const playFrom = startedAt ? startedAt + COUNTDOWN_MS : 0
  const ctx = useMemo<GameCtx>(
    () => ({ seed, startedAt: playFrom, slot }),
    [seed, playFrom, slot],
  )

  const state = useMemo<BaseGameState | null>(() => {
    if (!module || startIndex < 0) return null
    let acc = module.init(ctx)
    for (let i = startIndex + 1; i < log.length; i++) {
      acc = module.reduce(acc, log[i], ctx)
    }
    return acc
  }, [module, ctx, log, startIndex])

  const clock = useMemo<GameClock>(() => {
    const duration = module?.meta.durationMs
    const serverNow = () => Date.now() + clockOffset
    // Play time, not wall time: the countdown is not part of anyone's 30
    // seconds, so a timed game gets its full duration once it actually begins.
    const elapsed = () =>
      startedAt ? Math.max(0, serverNow() - startedAt - COUNTDOWN_MS) : 0
    /** Milliseconds left before play opens; 0 once it has. */
    const countdown = () =>
      startedAt ? Math.max(0, startedAt + COUNTDOWN_MS - serverNow()) : 0
    return {
      serverNow,
      elapsed,
      countdown,
      remaining: () => (duration == null ? null : Math.max(0, duration - elapsed())),
    }
  }, [module, startedAt, clockOffset])

  /* --- lifecycle ---------------------------------------------------------- */

  const started = startIndex >= 0

  // Poll hard only while a match is actually in play.
  useEffect(() => {
    const live = started && state?.phase === 'playing'
    transport.setTempo(live ? 'active' : 'lobby')
  }, [transport, started, state?.phase])

  // Both players ready -> the host opens the match. One writer avoids a race
  // where two `match:start` events land and the game restarts mid-play.
  useEffect(() => {
    if (slot !== 'host' || !gameId || started) return
    if (ready.host && ready.guest) transport.push(EV_START)
  }, [transport, slot, gameId, started, ready.host, ready.guest])

  // Timed games end on the host's clock, broadcast as a normal event so both
  // sides finish on the same tick of shared state rather than independently.
  const timeupSent = useRef(-1)
  useEffect(() => {
    const duration = module?.meta.durationMs
    if (slot !== 'host' || !duration || !started || !state || state.phase !== 'playing') return
    if (timeupSent.current === startedAt) return

    const fire = () => {
      timeupSent.current = startedAt
      transport.push(EV_TIMEUP)
    }
    const left = duration - Math.max(0, Date.now() + clockOffset - startedAt - COUNTDOWN_MS)
    if (left <= 0) {
      fire()
      return
    }
    const id = setTimeout(fire, left)
    return () => clearTimeout(id)
  }, [transport, module, slot, started, state, startedAt, clockOffset])

  /* --- actions ------------------------------------------------------------ */

  const send = useCallback(
    (type: string, data?: unknown) => transport.push(type, data),
    [transport],
  )

  const selectGame = useCallback(
    (id: GameId) => transport.push(EV_GAME, { gameId: id, seed: makeSeed() }),
    [transport],
  )

  const markReady = useCallback(() => transport.push(EV_READY), [transport])

  const rematch = useCallback(() => {
    if (gameId) transport.push(EV_GAME, { gameId, seed: makeSeed() })
  }, [transport, gameId])

  // Selecting "no game" returns both players to the picker without dropping
  // the room, so the code stays valid between games.
  const leaveGame = useCallback(() => transport.push(EV_GAME, { gameId: null, seed: 0 }), [transport])

  const other = OTHER[slot]
  const opponentPresent =
    transport.kind === 'bot' ||
    (peers[other].joined && Date.now() + clockOffset - peers[other].lastSeen < PRESENCE_TIMEOUT_MS)

  return {
    conn: snapshot.conn,
    stats,
    code: snapshot.code,
    slot,
    isBot: transport.kind === 'bot',
    peers,
    opponentPresent,
    gameId,
    ready,
    started,
    ctx,
    clock,
    state,
    send,
    selectGame,
    markReady,
    rematch,
    leaveGame,
  }
}

export { EV_TIMEUP } from './shellState'
