import type { MatchEvent, PeerState, RoomErrorCode, Slot } from '../../shared/protocol'

/** How hard the online transport should poll. Set by the shell per screen. */
export type Tempo = 'lobby' | 'active' | 'idle'

export type ConnState =
  | { phase: 'connecting' }
  | { phase: 'live' }
  /** Transient: requests are failing but the room is presumed intact. */
  | { phase: 'reconnecting' }
  /** Terminal: the room is gone or refused us. */
  | { phase: 'error'; code: RoomErrorCode }

export type TransportState = {
  conn: ConnState
  code: string
  slot: Slot
  epoch: number
  /** Full ordered log for the current epoch. Replayed to derive game state. */
  events: MatchEvent[]
  /** Local events not yet acknowledged, applied on top for instant feedback. */
  pending: MatchEvent[]
  peers: Record<Slot, PeerState>
  /** serverNow - clientNow, for shared countdowns. */
  clockOffset: number
  /** Live connection measurements, for the readout and the quality dot. */
  stats: NetStats
}

export type NetStats = {
  /** Smoothed round trip of a non-held request, in ms. 0 until measured. */
  rtt: number
  /** Most recent round trip, unsmoothed. */
  lastRtt: number
  /**
   * How long an opponent's event took to reach us: our clock (corrected for
   * skew) minus the server's stamp on the event. This is the number that
   * actually decides whether the game feels immediate.
   */
  lag: number
  /** True once the server has proved it honours held requests. */
  push: boolean
  /** True while a direct peer-to-peer channel is carrying moves. */
  p2p: boolean
  /**
   * Peer moves shown but not yet ordered by the server.
   *
   * Anything that *answers* an event must wait for this to be zero. Rendering
   * an unordered move early is free; replying to one is not, because the reply
   * can reach the sequencer before the move it answers and be rejected as
   * having nothing to answer.
   */
  provisional: number
  /** Requests sent this session, for the cost side of the trade. */
  requests: number
  /** We have a local event the sequencer has not acknowledged yet. */
  awaiting: boolean
}

export const emptyStats = (): NetStats => ({
  rtt: 0,
  lastRtt: 0,
  lag: 0,
  push: false,
  p2p: false,
  provisional: 0,
  requests: 0,
  awaiting: false,
})

export interface Transport {
  readonly kind: 'online' | 'bot'
  getState(): TransportState
  subscribe(fn: (state: TransportState) => void): () => void
  /** Optimistically applies locally, then ships to the sequencer. */
  push(type: string, data?: unknown): void
  /** Clears the log and bumps the epoch for a rematch. */
  reset(): Promise<void>
  setTempo(tempo: Tempo): void
  start(): void
  stop(): void
}

/**
 * Fallback cadence only.
 *
 * The transport long-polls: it leaves one request parked and the server answers
 * the moment anything happens, so an opponent's move arrives on the next network
 * hop rather than on the next tick. These delays are what it drops back to when
 * the server does not honour a held request — an older deployment, or a proxy
 * that buffers the response.
 */
export const TEMPO_MS: Record<Tempo, number> = {
  active: 220,
  lobby: 900,
  idle: 2_500,
}

export type { MatchEvent, PeerState, Slot }
