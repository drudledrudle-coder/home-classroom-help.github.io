import type { ComponentType } from 'react'
import type { GameId, MatchEvent, Slot } from '../../shared/protocol'
import type { BotFactory } from '../net/botTransport'

/**
 * Every game state extends this, which is the entire contract the shell needs
 * in order to render the HUD, the score line and the result card. A game
 * implements a reducer and a view; scoring, presentation and lifecycle are the
 * shell's problem.
 */
export type BaseGameState = {
  phase: 'playing' | 'over'
  scores: Record<Slot, number>
  winner: Slot | 'tie' | null
}

export type GameCtx = {
  /** Shared PRNG seed, published by the host with the game selection. */
  seed: number
  /** Server timestamp of match:start. 0 until the match begins. */
  startedAt: number
  /** Which side the local player is on. */
  slot: Slot
}

export type GameClock = {
  /** Best estimate of the sequencer's clock. */
  serverNow: () => number
  /** Milliseconds of *play*; 0 during the opening countdown. */
  elapsed: () => number
  /** Milliseconds left of the opening countdown; 0 once play has begun. */
  countdown: () => number
  /** Milliseconds left of `durationMs`, or null for untimed games. */
  remaining: () => number | null
}

export type GameViewProps<S extends BaseGameState> = {
  state: S
  /**
   * True when nothing in `state` is still provisional.
   *
   * A view may render an unordered peer move immediately, but must not *answer*
   * one — a reply can outrun the move it answers and reach the sequencer first,
   * where it is rejected for having nothing to respond to. Anything that sends
   * an event in response to state waits for this.
   */
  settled: boolean
  ctx: GameCtx
  clock: GameClock
  send: (type: string, data?: unknown) => void
}

export type GameMeta = {
  id: GameId
  title: string
  /** The whole rule, in one sentence. Shown on the card and above the board. */
  rule: string
  /** Short label for the lobby card, e.g. "Best of 5". */
  format: string
  /**
   * When set, the shell ends the match by pushing match:timeup at this point.
   * Untimed games (first to N) leave it undefined.
   */
  durationMs?: number
}

export type GameModule<S extends BaseGameState = BaseGameState> = {
  meta: GameMeta
  init: (ctx: GameCtx) => S
  /** Pure. Receives game events plus `match:timeup`. */
  reduce: (state: S, event: MatchEvent, ctx: GameCtx) => S
  bot: BotFactory
  View: ComponentType<GameViewProps<S>>
  /**
   * Optional async setup awaited before the player can ready up — used by Word
   * Sprint to fetch its dictionary. Both clients must finish it before the
   * match starts, or their reducers would disagree.
   */
  prepare?: () => Promise<void>
}

/** Erases the state parameter so modules of different shapes share a registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameModule = GameModule<any>

export type { GameId, Slot }
