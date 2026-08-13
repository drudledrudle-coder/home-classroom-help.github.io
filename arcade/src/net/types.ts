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
}

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

export const TEMPO_MS: Record<Tempo, number> = {
  // Fast enough that an opponent's move lands within a frame or two of feeling
  // instant, slow enough to stay inside Netlify's free function budget. See the
  // polling note in the README before lowering this.
  active: 220,
  lobby: 900,
  idle: 2_500,
}

export type { MatchEvent, PeerState, Slot }
