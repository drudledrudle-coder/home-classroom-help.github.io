import type { GameId } from '../../shared/protocol'
import { fourGame } from './four'
import { grabGame } from './grab'
import { nerveGame } from './nerve'
import { reactionGame } from './reaction'
import { salvoGame } from './salvo'
import { shiftGame } from './shift'
import { sprintGame } from './sprint'
import { tugGame } from './tug'
import type { AnyGameModule } from './types'

/**
 * The one place a two-player game is registered. Adding another means adding a
 * directory with the same four exports and one line here — nothing else in the
 * app needs to know it exists. See the README.
 *
 * Solo score games and single-device party games have their own registries,
 * under games/solo and games/party, because neither has an opponent to sync to.
 */
export const GAMES: Record<GameId, AnyGameModule> = {
  reaction: reactionGame,
  shift: shiftGame,
  sprint: sprintGame,
  grab: grabGame,
  tug: tugGame,
  nerve: nerveGame,
  four: fourGame,
  salvo: salvoGame,
}

/** Lobby order: quickest to grasp first, meatiest last. */
export const GAME_ORDER: GameId[] = [
  'reaction',
  'tug',
  'grab',
  'four',
  'nerve',
  'salvo',
  'shift',
  'sprint',
]

export const botFor = (id: GameId) => GAMES[id]?.bot ?? null
