import type { ComponentType } from 'react'

/**
 * Party games run on one device passed around a group. No room, no opponent
 * slots, no score — the phone deals information and the game happens in the
 * room. That makes them a third kind alongside versus and solo, sharing only
 * the design system.
 */

export type PartyId = 'imposter'

export type PartyMeta = {
  id: PartyId
  title: string
  rule: string
  /** Shown in the lobby row, e.g. "3–10 players". */
  players: string
}

export type PartyModule = {
  meta: PartyMeta
  Play: ComponentType<{ onExit: () => void }>
}
