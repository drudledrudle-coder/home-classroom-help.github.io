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
import type { Tempo, Transport, TransportState } from './types'
import { TEMPO_MS } from './types'

const ENDPOINT = '/api/room'
const REQUEST_TIMEOUT_MS = 8_000

export type OnlineInit = { mode: 'create' } | { mode: 'join'; code: string }

async function call(req: RoomReq): Promise<RoomRes> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...gateHeaders() },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    return (await res.json()) as RoomRes
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
    }
    state.pending = asLocalEvents()
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

    const res = await call(req)
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

    try {
      const res = await call({
        op: 'sync',
        code: state.code,
        playerId: me,
        since: lastSeq(),
        epoch: state.epoch,
        push: sending,
      })

      if (res.ok) {
        applyOk(res)
      } else if (res.error === 'NOT_A_MEMBER') {
        // Our seat was reaped or taken. Try to reclaim it before giving up —
        // this is the path a long backgrounded tab comes back through.
        const rejoin = await call({ op: 'join', code: state.code, playerId: me })
        if (rejoin.ok) applyOk(rejoin)
        else fatal(rejoin.error)
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
      // Network-level failure. Keep the log, keep retrying, and let the UI say
      // so rather than tearing the match down.
      consecutiveFailures += 1
      if (consecutiveFailures >= 2 && state.conn.phase === 'live') {
        patch({ conn: { phase: 'reconnecting' } })
      }
    } finally {
      inFlight = false
      if (running) schedule(dirty ? 0 : backoff())
    }
  }

  const backoff = () => {
    if (!consecutiveFailures) return TEMPO_MS[tempo]
    return Math.min(4_000, TEMPO_MS[tempo] * 2 ** consecutiveFailures)
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
      outbox.push({ id: draftId(), type, data })
      state = { ...state, pending: asLocalEvents() }
      emit()
      if (inFlight) dirty = true
      else schedule(0)
    },

    async reset() {
      outbox = []
      const res = await call({ op: 'reset', code: state.code, playerId: me })
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
      if (timer) clearTimeout(timer)
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
