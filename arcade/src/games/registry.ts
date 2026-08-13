import type { GameId } from '../../shared/protocol'
import { grabGame } from './grab'
import { reactionGame } from './reaction'
import { shiftGame } from './shift'
import { sprintGame } from './sprint'
import type { AnyGameModule } from './types'

/**
 * The one place a game is registered. Adding a fifth means adding a directory
 * with the same four exports and one line here — nothing else in the app needs
 * to know it exists. See the README.
 */
export const GAMES: Record<GameId, AnyGameModule> = {
  reaction: reactionGame,
  shift: shiftGame,
  sprint: sprintGame,
  grab: grabGame,
}

/** Lobby order: fastest to grasp first. */
export const GAME_ORDER: GameId[] = ['reaction', 'shift', 'grab', 'sprint']

export const botFor = (id: GameId) => GAMES[id]?.bot ?? null
