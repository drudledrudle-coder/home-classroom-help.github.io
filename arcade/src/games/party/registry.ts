import { imposterGame } from './imposter'
import type { PartyId, PartyModule } from './types'

/** Single-device group games. */
export const PARTY_GAMES: Record<PartyId, PartyModule> = {
  imposter: imposterGame,
}

export const PARTY_ORDER: PartyId[] = ['imposter']
