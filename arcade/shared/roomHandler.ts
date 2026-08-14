/**
 * The entire server. Pure request handling over a small storage interface, so
 * the same code backs Netlify Blobs in production and an in-memory Map during
 * local dev. Nothing here knows anything about any particular game.
 */

import type {
  DraftEvent,
  MatchEvent,
  PeerState,
  RoomErrorCode,
  RoomOkRes,
  RoomReq,
  RoomRes,
  Slot,
} from './protocol.ts'
import {
  MAX_EVENTS_PER_EPOCH,
  MAX_PUSH_BYTES,
  MAX_PUSH_EVENTS,
  MAX_SIGNAL_BYTES,
  MAX_SIGNAL_QUEUE,
  ROOM_TTL_MS,
  generateCode,
  normalizeCode,
} from './protocol.ts'

export type SlotInfo = { playerId: string; lastSeen: number }

export type RoomDoc = {
  code: string
  createdAt: number
  epoch: number
  seq: number
  events: MatchEvent[]
  slots: Record<Slot, SlotInfo | null>
  /** Pending WebRTC signalling per seat. Read once, then emptied. */
  inbox?: Record<Slot, string[]>
}

/** What a read returned, plus whatever the backend needs to detect a conflict. */
export type Stored = { doc: RoomDoc; version?: string }

export interface RoomStore {
  read(code: string): Promise<Stored | null>
  /** Returns false if `prev` is stale — the caller re-reads and retries. */
  write(code: string, doc: RoomDoc, prev: Stored | null): Promise<boolean>
  remove(code: string): Promise<void>
}

const WRITE_ATTEMPTS = 5

function makeError(error: RoomErrorCode, message?: string): RoomRes {
  return { ok: false, error, message }
}

function peersOf(doc: RoomDoc): Record<Slot, PeerState> {
  const one = (s: SlotInfo | null): PeerState => ({
    joined: !!s,
    lastSeen: s?.lastSeen ?? 0,
  })
  return { host: one(doc.slots.host), guest: one(doc.slots.guest) }
}

/** Who is seated, ignoring heartbeats. */
const membership = (peers: Record<Slot, PeerState>): string =>
  `${peers.host.joined ? 1 : 0}${peers.guest.joined ? 1 : 0}`

function slotFor(doc: RoomDoc, playerId: string): Slot | null {
  if (doc.slots.host?.playerId === playerId) return 'host'
  if (doc.slots.guest?.playerId === playerId) return 'guest'
  return null
}

function expired(doc: RoomDoc, now: number): boolean {
  return now - doc.createdAt > ROOM_TTL_MS
}

function ok(
  doc: RoomDoc,
  slot: Slot,
  events: MatchEvent[],
  reset: boolean,
  now: number,
  accepted: string[],
  signals: string[] = [],
): RoomOkRes {
  return {
    signals,
    ok: true,
    code: doc.code,
    slot,
    epoch: doc.epoch,
    seq: doc.seq,
    events,
    reset,
    now,
    peers: peersOf(doc),
    accepted,
  }
}

/**
 * Read-modify-write with optimistic retry. Two players can genuinely race here
 * (both tapping the same dot in the same tick), so a lost update must retry
 * rather than silently drop an event.
 */
async function mutate(
  store: RoomStore,
  code: string,
  now: number,
  apply: (doc: RoomDoc) => RoomRes | { commit: RoomDoc; res: RoomRes },
): Promise<RoomRes> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const prev = await store.read(code)
    if (!prev) return makeError('NO_ROOM')
    if (expired(prev.doc, now)) {
      await store.remove(code)
      return makeError('NO_ROOM')
    }

    // Deep clone so a failed attempt cannot leak partial mutations into the retry.
    const draft: RoomDoc = JSON.parse(JSON.stringify(prev.doc))
    const outcome = apply(draft)
    if ('ok' in outcome) return outcome

    if (await store.write(code, outcome.commit, prev)) return outcome.res
  }
  return makeError('CONFLICT', 'Room is busy, retry')
}

/**
 * How a held request waits. Injected rather than imported so the same handler
 * runs under Netlify Functions and the dev server, and so tests can drive it
 * without real time passing.
 */
export type HoldOptions = {
  /**
   * Longest a sync may be parked. Deliberately under PRESENCE_TIMEOUT_MS: a
   * parked request only refreshes presence when it *starts*, so holding longer
   * than the timeout would make a perfectly healthy player look disconnected to
   * their opponent.
   */
  holdMs: number
  /** How often a parked request re-reads the room, in the lobby. */
  pollMs: number
  /** How often it re-reads while a match is actually in play. */
  hotPollMs: number
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export const DEFAULT_HOLD: HoldOptions = {
  // A parked request refreshes presence only when it starts, so this is really
  // the heartbeat interval. PRESENCE_TIMEOUT_MS allows three of these to be
  // missed before an opponent is called dropped, which keeps a slow phone from
  // being mistaken for an absent one.
  holdMs: 3_000,
  // Each tick is a store read, so these trade discovery latency against read
  // volume. Nobody is waiting on a move in the lobby, so it ticks slowly and
  // costs less than it used to.
  pollMs: 220,
  // Measured: 300ms gives a 335ms median for an opponent's move, 120ms gives
  // 96ms, and 45ms gives 93ms. Below roughly 100ms the interval stops being the
  // bottleneck — what is left is the HTTP round trip and the render, which no
  // amount of faster reading removes. So this sits just under that floor rather
  // than as low as it will go: 45ms would nearly triple the read volume to buy
  // about 3ms.
  hotPollMs: 70,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
}

export async function handleRoomRequest(
  store: RoomStore,
  req: RoomReq,
  now: number = Date.now(),
  hold?: HoldOptions,
): Promise<RoomRes> {
  if (!req || typeof req !== 'object' || typeof (req as RoomReq).op !== 'string') {
    return makeError('BAD_REQUEST')
  }
  if (!('playerId' in req) || typeof req.playerId !== 'string' || !req.playerId) {
    return makeError('BAD_REQUEST', 'playerId required')
  }

  if (req.op === 'create') return createRoom(store, req.playerId, now)

  const code = 'code' in req ? normalizeCode(String(req.code ?? '')) : null
  if (!code) return makeError('BAD_REQUEST', 'bad code')

  switch (req.op) {
    case 'join':
      return joinRoom(store, code, req.playerId, now)
    case 'sync':
      return syncRoom(store, code, req, now, hold)
    case 'reset':
      return resetRoom(store, code, req.playerId, now)
    case 'leave':
      return leaveRoom(store, code, req.playerId, now)
    default:
      return makeError('BAD_REQUEST')
  }
}

async function createRoom(store: RoomStore, playerId: string, now: number): Promise<RoomRes> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateCode()
    const existing = await store.read(code)
    if (existing && !expired(existing.doc, now)) continue

    const doc: RoomDoc = {
      code,
      createdAt: now,
      epoch: 1,
      seq: 0,
      events: [],
      slots: { host: { playerId, lastSeen: now }, guest: null },
    }
    if (await store.write(code, doc, existing)) {
      return ok(doc, 'host', [], true, now, [])
    }
  }
  return makeError('SERVER', 'could not allocate a room code')
}

async function joinRoom(
  store: RoomStore,
  code: string,
  playerId: string,
  now: number,
): Promise<RoomRes> {
  return mutate(store, code, now, (doc) => {
    // Reclaiming an existing seat covers the refresh case: same tab, same
    // playerId, so the player drops straight back into their old slot.
    let slot = slotFor(doc, playerId)

    if (!slot) {
      if (!doc.slots.host) slot = 'host'
      else if (!doc.slots.guest) slot = 'guest'
      else return makeError('ROOM_FULL')
    }

    doc.slots[slot] = { playerId, lastSeen: now }
    // A joiner always gets the full log so it can rebuild a game in progress.
    return { commit: doc, res: ok(doc, slot, doc.events, true, now, []) }
  })
}

async function syncRoom(
  store: RoomStore,
  code: string,
  req: Extract<RoomReq, { op: 'sync' }>,
  now: number,
  hold?: HoldOptions,
): Promise<RoomRes> {
  const push = Array.isArray(req.push) ? req.push : []
  if (push.length > MAX_PUSH_EVENTS) return makeError('TOO_BIG')
  if (push.length && JSON.stringify(push).length > MAX_PUSH_BYTES) return makeError('TOO_BIG')

  const first = await syncOnce(store, code, req, now)

  // Answer straight away if there is anything to say, or if the caller did not
  // ask to wait. Only a genuinely empty sync is worth parking.
  if (!hold || !req.wait || !first.ok) return first
  if (first.events.length || first.reset || first.accepted.length || first.signals?.length) {
    return { ...first, waited: false }
  }

  return holdOpen(store, code, req, first, hold)
}

/**
 * Park an empty sync until the room changes.
 *
 * Presence was already refreshed by the `syncOnce` above, and this loop only
 * *reads* — parking must not turn one sync into forty writes, which would cost
 * more than the polling it replaces and make write contention far likelier.
 */
async function holdOpen(
  store: RoomStore,
  code: string,
  req: Extract<RoomReq, { op: 'sync' }>,
  first: Extract<RoomRes, { ok: true }>,
  hold: HoldOptions,
): Promise<RoomRes> {
  const deadline = hold.now() + hold.holdMs
  const since = Number.isFinite(req.since) ? Number(req.since) : 0
  // Membership only — deliberately *not* the whole peer record.
  //
  // `lastSeen` moves every time either player syncs, so waking on it made each
  // client's hold fire on the other's presence write: A syncs, B wakes, B syncs,
  // A wakes, for ever. That ping-pong turned one parked request into a
  // continuous write loop, which costs more than the polling it replaced and
  // adds contention on every write. A player arriving or leaving is a real
  // change worth waking for; a heartbeat is not.
  const before = membership(first.peers)

  const step = req.hot ? hold.hotPollMs : hold.pollMs

  while (hold.now() < deadline) {
    await hold.sleep(step)

    const stored = await store.read(code)
    // The room went away under us; let the client re-handshake.
    if (!stored) return makeError('NO_ROOM')

    const doc = stored.doc
    const slot = slotFor(doc, req.playerId)
    if (!slot) return makeError('NOT_A_MEMBER')

    const stale = req.epoch !== doc.epoch
    const events = stale ? doc.events : doc.events.filter((e) => e.seq > since)
    const peersChanged = membership(peersOf(doc)) !== before
    // Waking on signalling matters: a WebRTC handshake is a few messages back
    // and forth, and making each one wait out a hold would stretch a
    // sub-second negotiation into ten seconds or more.
    const waiting = (doc.inbox?.[slot] ?? []).length > 0

    if (events.length || stale || peersChanged || waiting) {
      const now = hold.now()
      // Deliberately does not drain the inbox here: this path only reads, and
      // draining needs a write. The client re-syncs immediately, and that sync
      // collects it through `syncOnce`.
      return { ...ok(doc, slot, events, stale, now, []), waited: true }
    }
  }

  return { ...first, now: hold.now(), waited: true }
}

async function syncOnce(
  store: RoomStore,
  code: string,
  req: Extract<RoomReq, { op: 'sync' }>,
  now: number,
): Promise<RoomRes> {
  const push = Array.isArray(req.push) ? req.push : []

  return mutate(store, code, now, (doc) => {
    const slot = slotFor(doc, req.playerId)
    // Losing membership means the room was reaped or someone took the seat.
    // The client responds by re-joining rather than silently going quiet.
    if (!slot) return makeError('NOT_A_MEMBER')

    doc.slots[slot] = { playerId: req.playerId, lastSeen: now }

    // Signalling: hand ours to the other seat, take whatever is waiting for us.
    // Bounded so a stuck or hostile client cannot grow the room document
    // without limit — signalling is a handshake, not a channel.
    const inbox = doc.inbox ?? { host: [], guest: [] }
    const outgoing = Array.isArray(req.signal) ? req.signal : []
    if (outgoing.length) {
      const other: Slot = slot === 'host' ? 'guest' : 'host'
      const room = [...(inbox[other] ?? []), ...outgoing]
        .filter((m) => typeof m === 'string' && m.length <= MAX_SIGNAL_BYTES)
        .slice(-MAX_SIGNAL_QUEUE)
      inbox[other] = room
    }
    const mine = inbox[slot] ?? []
    inbox[slot] = []
    doc.inbox = inbox

    const accepted: string[] = []
    for (const draft of push) {
      if (!isDraft(draft)) continue
      if (doc.events.length >= MAX_EVENTS_PER_EPOCH) break
      doc.seq += 1
      doc.events.push({
        seq: doc.seq,
        at: now,
        from: slot,
        type: draft.type,
        data: draft.data,
      })
      accepted.push(draft.id)
    }

    // An epoch mismatch means the client is looking at a match that no longer
    // exists (a rematch started). Resend everything and tell it to start over.
    const stale = req.epoch !== doc.epoch
    const since = Number.isFinite(req.since) ? Number(req.since) : 0
    const events = stale ? doc.events : doc.events.filter((e) => e.seq > since)

    return { commit: doc, res: ok(doc, slot, events, stale, now, accepted, mine) }
  })
}

async function resetRoom(
  store: RoomStore,
  code: string,
  playerId: string,
  now: number,
): Promise<RoomRes> {
  return mutate(store, code, now, (doc) => {
    const slot = slotFor(doc, playerId)
    if (!slot) return makeError('NOT_A_MEMBER')

    doc.epoch += 1
    doc.seq = 0
    doc.events = []
    doc.slots[slot] = { playerId, lastSeen: now }

    return { commit: doc, res: ok(doc, slot, [], true, now, []) }
  })
}

async function leaveRoom(
  store: RoomStore,
  code: string,
  playerId: string,
  now: number,
): Promise<RoomRes> {
  const res = await mutate(store, code, now, (doc) => {
    const slot = slotFor(doc, playerId)
    if (!slot) return makeError('NOT_A_MEMBER')
    doc.slots[slot] = null
    return { commit: doc, res: ok(doc, slot, [], false, now, []) }
  })

  // Reap the room once nobody is left in it.
  const after = await store.read(code)
  if (after && !after.doc.slots.host && !after.doc.slots.guest) {
    await store.remove(code)
  }
  return res
}

function isDraft(v: unknown): v is DraftEvent {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as DraftEvent).id === 'string' &&
    typeof (v as DraftEvent).type === 'string'
  )
}
