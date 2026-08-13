import { mergeGame } from './merge'
import { oddOneGame } from './oddone'
import { recallGame } from './recall'
import { rollGame } from './roll'
import { snakeGame } from './snake'
import { stackGame } from './stack'
import type { SoloId, SoloModule } from './types'

/**
 * Solo score games. Adding one is a directory exporting a `SoloModule` plus a
 * line here and an id in `SoloId`.
 */
export const SOLO_GAMES: Record<SoloId, SoloModule> = {
  merge: mergeGame,
  snake: snakeGame,
  stack: stackGame,
  roll: rollGame,
  recall: recallGame,
  oddone: oddOneGame,
}

/** Most familiar first. */
export const SOLO_ORDER: SoloId[] = ['merge', 'snake', 'stack', 'roll', 'recall', 'oddone']
