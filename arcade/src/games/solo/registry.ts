import { oddOneGame } from './oddone'
import type { SoloId, SoloModule } from './types'

/**
 * Solo score games. Adding one is a directory exporting a `SoloModule` plus a
 * line here and an id in `SoloId`.
 */
export const SOLO_GAMES: Record<SoloId, SoloModule> = {
  oddone: oddOneGame,
}

export const SOLO_ORDER: SoloId[] = ['oddone']
