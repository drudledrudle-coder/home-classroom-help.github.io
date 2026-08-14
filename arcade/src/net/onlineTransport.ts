import type {
  DraftEvent,
  MatchEvent,
  PeerState,
  RoomErrorCode,
  RoomReq,
  RoomRes,
  Slot,
} from '../../shared/protocol'
import { MAX_PUSH_EVENTS } from '../../shared/protocol'
import { clearGateToken, gateHeaders } from './gate'
import { draftId, playerId } from './identity'
import { createPeer } from './peer'
import type { PeerApi, PeerMessage } from './peer'
import type { NetStats, Tempo, Transport, TransportState } from './types'
import { TEMPO_MS, emptyStats } from './types'

const ENDPOINT = '/api/room'
/** Short requests. A held request gets its own, longer, budget. */
const REQUEST_TIMEOUT_MS = 8_000
/** Must exceed the server's hold, or we would abort every parked request. */
const HELD_TIMEOUT_MS = 12_000

export type OnlineInit = { mode: 'create' } | { mode: 'join'; code: string }

type Timed = { res: RoomRes; rtt: number }

async function call(
  req: RoomReq,
  held = false,
  controller: AbortController = new AbortController(),
): Promise<Timed> {
  const timer = setTimeout(
    () => controller.abort(),
    held ? HELD_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
  )
  const started = performance.now()
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...gateHeaders() },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    const body = (await res.json()) as RoomRes
    return { res: body, rtt: performance.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

const emptyPeers = (): Record<Slot, PeerState> => ({
  host: { joined: false, lastSeen: 0 },
  guest: { joined: false, lastSeen: 0 },
})

export function createOnlineTransport(init: OnlineInit): Transport {
  const me = playerId()

  let state: TransportState = {
    conn: { phase: 'connecting' },
    code: init.mode === 'join' ? init.code : '',
    slot: 'host',
    epoch: 0,
    events: [],
    pending: [],
    peers: emptyPeers(),
    clockOffset: 0,
    stats: emptyStats(),
  }

  const listeners = new Set<(s: TransportState) => void>()
  let outbox: DraftEvent[] = []
  let tempo: Tempo = 'lobby'
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let stopped = false
  /** Set once the server has actually seated us. */
  let joined = false
  let inFlight = false
  /** A push arrived while a sync was in flight; go again immediately after. */
  let dirty = false
  let consecutiveFailures = 0
  let stats: NetStats = emptyStats()
  /** Cleared the first time the server proves it honours a held request. */
  let pollingFallback = false
  /** Abort handle for a request currently parked on the server. */
  let heldAbort: AbortController | null = null
  /** True while we deliberately cancelled a hold, so it is not a real failure. */
  let cancelling = false

  /* -- fast lane ----------------------------------------------------------- */
  let peer: PeerApi | null = null
  let outSignals: string[] = []
  /**
   * Moves heard from the peer before the server ordered them.
   *
   * Rendered on top of the confirmed log exactly like our own unacknowledged
   * moves, and cleared the moment the sequenced copy shows up. The reducer is
   * pure and the log is replayed whole, so a provisional that turns out to be
   * ordered differently simply corrects itself on the next sync.
   */
  let peerPending: Array<{ at: number; event: MatchEvent }> = []
  /** Safety net: a provisional never outlives the server round trip by much. */
  const PEER_TTL_MS = 2_000

  const peerEvents = (): MatchEvent[] => {
    const now = Date.now()
    peerPending = peerPending.filter((p) => now - p.at < PEER_TTL_MS)
    return peerPending.map((p) => p.event)
  }

  /** A confirmed event retires the provisional it matches. */
  const retirePeer = (confirmed: MatchEvent[]) => {
    if (!peerPending.length || !confirmed.length) return
    for (const event of confirmed) {
      const i = peerPending.findIndex(
        (p) =>
          p.event.from === event.from &&
          p.event.type === event.type &&
          JSON.stringify(p.event.data) === JSON.stringify(event.data),
      )
      if (i >= 0) peerPending.splice(i, 1)
    }
  }

  const onPeerMessage = (msg: PeerMessage) => {
    const theirs: Slot = state.slot === 'host' ? 'guest' : 'host'
    // Seq is provisional and sorts after everything confirmed, the same trick
    // the local outbox uses. The server's ordering replaces it shortly.
    peerPending.push({
      at: Date.now(),
      event: {
        seq: Number.MAX_SAFE_INTEGER - 1_000_000 - peerPending.length,
        at: Date.now() + state.clockOffset,
        from: theirs,
        type: msg.type,
        data: msg.data,
      },
    })
    stats = { ...stats, provisional: peerPending.length }
    state = { ...state, pending: [...peerEvents(), ...asLocalEvents()], stats }
    emit()
  }

  const openPeer = () => {
    if (peer || !state.code) return
    peer = createPeer({
      slot: state.slot,
      sendSignal: (raw) => {
        outSignals.push(raw)
        // Nudge the loop so the handshake is not paced by the hold.
        if (!inFlight) schedule(0)
        else if (heldAbort) {
          cancelling = true
          heldAbort.abort()
          heldAbort = null
        }
      },
      onMessage: onPeerMessage,
      onOpen: () => {
        stats = { ...stats, p2p: true }
        state = { ...state, stats }
        emit()
      },
      onClosed: () => {
        peerPending = []
        stats = { ...stats, p2p: false, provisional: 0 }
        state = { ...state, stats }
        emit()
      },
    })
  }

  const emit = () => {
    const snapshot = state
    listeners.forEach((fn) => fn(snapshot))
  }

  const patch = (next: Partial<TransportState>) => {
    state = { ...state, ...next }
    emit()
  }

  /** Optimistic events are rendered as if the server had already ordered them. */
  const NO_PENDING: MatchEvent[] = []
  const asLocalEvents = (): MatchEvent[] =>
    outbox.length === 0
      ? NO_PENDING
      : outbox.map((d, i) => ({
          seq: Number.MAX_SAFE_INTEGER - outbox.length + i,
          at: Date.now() + state.clockOffset,
          from: state.slot,
          type: d.type,
          data: d.data,
        }))

  const schedule = (delay = TEMPO_MS[tempo]) => {
    if (!running) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(tick, delay)
  }

  /**
   * Round trip is only meaningful for requests the server answered immediately.
   * A parked request's duration is mostly the hold, so folding it into the
   * average would report a 4-second connection on a perfect one.
   */
  const noteRtt = (rtt: number) => {
    const prev = stats.rtt
    stats = {
      ...stats,
      lastRtt: Math.round(rtt),
      // Exponential smoothing: one slow request should nudge the reading, not
      // define it, and the dot must not flicker on a single hiccup.
      rtt: Math.round(prev ? prev * 0.7 + rtt * 0.3 : rtt),
    }
  }

  /** How long an opponent's event took to get here, corrected for clock skew. */
  const noteLag = (events: MatchEvent[]) => {
    const theirs = events.filter((e) => e.from !== state.slot && e.from !== 'system')
    if (!theirs.length) return
    const newest = theirs[theirs.length - 1]
    const observed = Date.now() + state.clockOffset - newest.at
    // Skew correction is imperfect, so clamp rather than report a negative lag.
    stats = { ...stats, lag: Math.max(0, Math.round(observed)) }
  }

  const applyOk = (res: Extract<RoomRes, { ok: true }>) => {
    // Preserve the array identity when nothing new arrived. Most syncs are
    // empty, and a fresh array every 220ms would re-run every game reducer and
    // re-render the board for no reason.
    const events = res.reset
      ? res.events
      : res.events.length
        ? [...state.events, ...res.events]
        : state.events
    outbox = outbox.filter((d) => !res.accepted.includes(d.id))
    consecutiveFailures = 0
    joined = true

    state = {
      ...state,
      conn: { phase: 'live' },
      code: res.code,
      slot: res.slot,
      epoch: res.epoch,
      events,
      peers: res.peers,
      clockOffset: res.now - Date.now(),
      pending: [],
      stats,
    }
    if (res.events.length) noteLag(res.events)
    // Only worth a handshake once there is somebody to hand a channel to.
    if (res.peers.host.joined && res.peers.guest.joined) openPeer()
    retirePeer(res.events)
    const provisional = peerEvents()
    state.pending = [...provisional, ...asLocalEvents()]
    state.stats = { ...stats, awaiting: outbox.length > 0, provisional: provisional.length }
    stats = state.stats
    emit()
  }

  const fatal = (code: RoomErrorCode) => {
    patch({ conn: { phase: 'error', code } })
    running = false
    if (timer) clearTimeout(timer)
  }

  async function handshake(): Promise<boolean> {
    const req: RoomReq =
      init.mode === 'create'
        ? { op: 'create', playerId: me }
        : { op: 'join', code: init.code, playerId: me }

    const { res, rtt } = await call(req)
    noteRtt(rtt)
    if (!res.ok) {
      // ROOM_FULL / NO_ROOM are user-facing dead ends; surface them as-is.
      if (res.error === 'LOCKED') clearGateToken()
      fatal(res.error)
      return false
    }
    applyOk(res)
    return true
  }

  async function tick() {
    if (!running || inFlight) return
    // Nothing to gain from polling a backgrounded tab; the visibility handler
    // fires an immediate sync on the way back.
    if (typeof document !== 'undefined' && document.hidden && !outbox.length) {
      schedule(1_000)
      return
    }

    inFlight = true
    dirty = false
    const sending = outbox.slice(0, MAX_PUSH_EVENTS)

    // Park the request only when there is nothing of our own to deliver. A push
    // must land now; waiting on it would add the whole hold to our own move.
    const held = !sending.length && !pollingFallback
    // Kept so `push` can cut a parked request loose the instant we have
    // something of our own to send. Without this a tap could sit behind a
    // four-second hold, which is precisely the delay this is meant to remove.
    heldAbort = held ? new AbortController() : null

    try {
      const { res, rtt } = await call(
        {
          op: 'sync',
          code: state.code,
          playerId: me,
          since: lastSeq(),
          epoch: state.epoch,
          push: sending,
          wait: held,
          // Only ask the server to read the room aggressively while a match is
          // actually in play; in the lobby nobody is waiting on a move.
          hot: tempo === 'active',
          signal: outSignals.length ? outSignals.splice(0, outSignals.length) : undefined,
        },
        held,
        heldAbort ?? undefined,
      )
      stats = { ...stats, requests: stats.requests + 1 }
      if (!held) noteRtt(rtt)

      if (res.ok) {
        if (res.signals?.length) for (const raw of res.signals) peer?.accept(raw)
        if (res.waited) stats = { ...stats, push: true }
        // A server that ignores `wait` answers an empty sync instantly. Left
        // alone that would spin as fast as the network allows, so fall back to
        // the timed cadence instead.
        else if (held && rtt < 500) pollingFallback = true
        applyOk(res)
      } else if (res.error === 'NOT_A_MEMBER') {
        // Our seat was reaped or taken. Try to reclaim it before giving up —
        // this is the path a long backgrounded tab comes back through.
        const rejoin = await call({ op: 'join', code: state.code, playerId: me })
        if (rejoin.res.ok) applyOk(rejoin.res)
        else fatal(rejoin.res.error)
      } else if (res.error === 'CONFLICT') {
        // Write contention. Harmless; the next tick re-reads.
        patch({ conn: { phase: 'live' } })
      } else {
        // The token expired, or the site key was changed under us. Drop it so
        // the app falls back to the key screen instead of retrying forever.
        if (res.error === 'LOCKED') clearGateToken()
        fatal(res.error)
      }
    } catch {
      if (cancelling) {
        // We aborted this hold ourselves to make room for a push. Nothing is
        // wrong with the connection, so it must not count towards backoff or
        // flip the UI to "reconnecting".
        cancelling = false
      } else {
        // Network-level failure. Keep the log, keep retrying, and let the UI say
        // so rather than tearing the match down.
        consecutiveFailures += 1
        if (consecutiveFailures >= 2 && state.conn.phase === 'live') {
          patch({ conn: { phase: 'reconnecting' } })
        }
      }
    } finally {
      inFlight = false
      heldAbort = null
      if (running) schedule(dirty ? 0 : backoff())
    }
  }

  const backoff = () => {
    if (consecutiveFailures) {
      return Math.min(4_000, TEMPO_MS[tempo] * 2 ** consecutiveFailures)
    }
    // With a working hold there is no cadence to keep: the next request is
    // parked immediately, so the connection is always listening.
    if (stats.push && !pollingFallback) return 0
    return TEMPO_MS[tempo]
  }

  const lastSeq = () =>
    state.events.length ? state.events[state.events.length - 1].seq : 0

  const onVisibility = () => {
    if (!document.hidden && running) schedule(0)
  }

  return {
    kind: 'online',
    getState: () => state,

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    push(type, data) {
      const id = draftId()
      outbox.push({ id, type, data })
      // Straight down the channel as well. The server copy still decides the
      // order; this only gets it onto their screen sooner.
      peer?.send({ id, type, data })
      // Render it immediately. The board must never wait on the network to show
      // the player their own move — the log only confirms what we already drew.
      stats = { ...stats, awaiting: true }
      state = { ...state, pending: asLocalEvents(), stats }
      emit()

      if (inFlight) {
        dirty = true
        // Cut a parked request loose so this goes out now rather than after the
        // hold expires.
        if (heldAbort) {
          cancelling = true
          heldAbort.abort()
          heldAbort = null
        }
      } else {
        schedule(0)
      }
    },

    async reset() {
      outbox = []
      const { res } = await call({ op: 'reset', code: state.code, playerId: me })
      if (res.ok) applyOk(res)
    },

    setTempo(next) {
      if (tempo === next) return
      tempo = next
      if (running) schedule(0)
    },

    start() {
      if (running) return
      running = true
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility)
      }
      void handshake().then((okToRun) => {
        if (okToRun && running) schedule()
      })
    },

    stop() {
      // Idempotent: a second stop must not fire a second `leave`, which could
      // land after a later join and evict that session.
      if (stopped) return
      stopped = true
      running = false
      peer?.close()
      peer = null
      if (timer) clearTimeout(timer)
      // Release a parked request rather than leaving the server holding it open
      // for a client that has gone.
      if (heldAbort) {
        cancelling = true
        heldAbort.abort()
        heldAbort = null
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      // Only release a seat we actually hold. A join-mode transport knows its
      // code before it has joined anything, so without this check a transport
      // that is stopped before handshaking would send `leave` for a room it
      // never entered — and because the player id is stable across reloads,
      // that evicts whichever session *is* legitimately sitting there.
      if (joined && state.code) {
        void fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...gateHeaders() },
          body: JSON.stringify({ op: 'leave', code: state.code, playerId: me }),
          keepalive: true,
        }).catch(() => {})
      }
      listeners.clear()
    },
  }
}
