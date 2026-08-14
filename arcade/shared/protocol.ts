/**
 * Wire protocol shared by the browser client, the Netlify function, and the
 * local dev emulator. Keep this file dependency-free — it is imported by three
 * different runtimes.
 *
 * The server is a *sequencer*, not a referee. It never runs game logic. It
 * stamps incoming events with a monotonic `seq` plus a server timestamp and
 * appends them to a log. Both clients replay that identical log through the
 * same pure reducer, so they always converge without the server knowing what
 * tic-tac-toe is. That is what makes a refresh recoverable (refetch the log,
 * replay it) and what keeps round-trip time out of the reaction game.
 */

export const GAME_IDS = [
  'reaction',
  'shift',
  'sprint',
  'grab',
  'tug',
  'nerve',
  'four',
  'salvo',
] as const
export type GameId = (typeof GAME_IDS)[number]

export type Slot = 'host' | 'guest'
export const OTHER: Record<Slot, Slot> = { host: 'guest', guest: 'host' }

/** An event after the server has ordered it. */
export type MatchEvent = {
  seq: number
  at: number
  from: Slot | 'system'
  type: string
  data?: unknown
}

/** An event as the client submits it, before ordering. */
export type DraftEvent = {
  /** Client-unique id, echoed back so the sender can retire its optimistic copy. */
  id: string
  type: string
  data?: unknown
}

export type PeerState = {
  joined: boolean
  lastSeen: number
}

export type RoomSnapshot = {
  code: string
  epoch: number
  seq: number
  peers: Record<Slot, PeerState>
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

export type CreateReq = { op: 'create'; playerId: string }
export type JoinReq = { op: 'join'; code: string; playerId: string }
export type LeaveReq = { op: 'leave'; code: string; playerId: string }

/**
 * The workhorse. Push and poll are deliberately the same round trip — at two
 * players polling several times a second, splitting them would double the
 * function invocations for no benefit.
 */
export type SyncReq = {
  op: 'sync'
  code: string
  playerId: string
  /** Highest seq the client has already applied. */
  since: number
  /** Epoch the client believes it is on; a mismatch forces a full resend. */
  epoch: number
  push?: DraftEvent[]
  /**
   * Hold the request open until something actually happens.
   *
   * This is what turns the protocol from polling into push: instead of asking
   * every 220ms and almost always being told "nothing", the client leaves one
   * request parked and the server answers the moment the opponent writes. The
   * event arrives on the next network hop rather than on the next tick.
   */
  wait?: boolean
  /**
   * A match is actually in play, so answer as fast as possible.
   *
   * Each tick of a held request is a store read, so the polling rate is a
   * straight trade of read volume against how quickly a move is noticed. That
   * trade is only worth making while someone is waiting on a move: in the lobby
   * a fast tick buys nothing and costs the same.
   */
  hot?: boolean
  /**
   * WebRTC signalling addressed to the *other* seat.
   *
   * Rides the sync rather than getting its own endpoint: a handshake is three
   * or four small messages and the sync is already parked waiting, so this
   * costs no extra round trips and no extra function invocations.
   *
   * Deliberately not events. SDP blobs are kilobytes and would sit in the
   * replayed log for the rest of the match, for something no reducer will ever
   * read.
   */
  signal?: string[]
}

/** Clears the event log and bumps the epoch, so a rematch starts from zero. */
export type ResetReq = { op: 'reset'; code: string; playerId: string }

export type RoomReq = CreateReq | JoinReq | LeaveReq | SyncReq | ResetReq

/* -------------------------------------------------------------------------- */
/* Responses                                                                   */
/* -------------------------------------------------------------------------- */

export type RoomErrorCode =
  | 'NO_ROOM'
  | 'ROOM_FULL'
  | 'NOT_A_MEMBER'
  | 'BAD_REQUEST'
  | 'TOO_BIG'
  | 'CONFLICT'
  | 'SERVER'
  /** Site key is set and this request did not carry a valid unlock token. */
  | 'LOCKED'

export type RoomErrorRes = { ok: false; error: RoomErrorCode; message?: string }

export type RoomOkRes = {
  ok: true
  code: string
  slot: Slot
  epoch: number
  seq: number
  /** Events with seq > `since`, or the whole log when the epoch moved. */
  events: MatchEvent[]
  /** True when the client must discard local state before applying `events`. */
  reset: boolean
  /** Server clock, so clients can correct for skew on shared countdowns. */
  now: number
  peers: Record<Slot, PeerState>
  /**
   * True when the server actually held this request open. Its absence tells a
   * client talking to an older deployment that long-polling is not available,
   * so it can fall back to timed polling instead of asking every few seconds.
   */
  waited?: boolean
  /** Signalling addressed to this seat. Delivered once, then cleared. */
  signals?: string[]
  /** Ids from `push` that the server accepted, so the client can retire them. */
  accepted: string[]
}

export type RoomRes = RoomOkRes | RoomErrorRes

/* -------------------------------------------------------------------------- */
/* Room codes                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Consonants only. Two reasons: it removes the 0/O and 1/I/L confusions when
 * someone reads a code off another person's screen, and with no vowels a random
 * four-letter code cannot accidentally spell a real word — which matters when
 * the codes are user-visible and unmoderated.
 */
export const CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ'
export const CODE_LENGTH = 4

export function generateCode(random: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  }
  return out
}

export function normalizeCode(raw: string): string | null {
  const up = raw.trim().toUpperCase()
  if (up.length !== CODE_LENGTH) return null
  for (const ch of up) if (!CODE_ALPHABET.includes(ch)) return null
  return up
}

/* -------------------------------------------------------------------------- */
/* Limits                                                                      */
/* -------------------------------------------------------------------------- */

/** A peer that has not synced within this window is treated as gone. */
/**
 * A client parked on a held sync only refreshes its presence when that request
 * starts, so this must tolerate several missed heartbeats — otherwise a player
 * sitting on a perfectly good connection gets reported as dropped. Three holds'
 * worth of margin, at the cost of a genuinely dead peer taking that long to
 * notice.
 */
export const PRESENCE_TIMEOUT_MS = 9_000
/** Rooms are abandoned, not deleted; this is when we stop honouring them. */
export const ROOM_TTL_MS = 3 * 60 * 60 * 1000
export const MAX_EVENTS_PER_EPOCH = 2_000
export const MAX_PUSH_BYTES = 8_192
export const MAX_PUSH_EVENTS = 32
/** One SDP blob is a couple of KB; this leaves room without being a channel. */
export const MAX_SIGNAL_BYTES = 12_288
export const MAX_SIGNAL_QUEUE = 24
