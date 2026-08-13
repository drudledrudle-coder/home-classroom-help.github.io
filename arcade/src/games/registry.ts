import type { GameId } from '../../shared/protocol'
import { grabGame } from './grab'
import { nerveGame } from './nerve'
import { reactionGame } from './reaction'
import { shiftGame } from './shift'
import { sprintGame } from './sprint'
import { tugGame } from './tug'
import type { AnyGameModule } from './types'

/**
 * The one place a two-player game is registered. Adding another means adding a
 * directory with the same four exports and one line here — nothing else in the
 * app needs to know it exists. See the README.
 *
 * Solo score games live in a separate registry (games/solo/registry.ts) because
 * they have no opponent, no room and no event log.
 */
export const GAMES: Record<GameId, AnyGameModule> = {
  reaction: reactionGame,
  shift: shiftGame,
  sprint: sprintGame,
  grab: grabGame,
  tug: tugGame,
  nerve: nerveGame,
}

/** Lobby order: quickest to grasp first, meatiest last. */
export const GAME_ORDER: GameId[] = ['reaction', 'tug', 'grab', 'nerve', 'shift', 'sprint']

export const botFor = (id: GameId) => GAMES[id]?.bot ?? null
