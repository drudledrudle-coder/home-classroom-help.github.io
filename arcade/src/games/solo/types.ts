import type { ComponentType } from 'react'

/**
 * Solo score games are deliberately *not* built on the room engine. There is no
 * opponent, so there is nothing to synchronise, no log to replay and no seed to
 * agree on — forcing them through the versus machinery would add a sequencer to
 * a game that only ever runs in one browser.
 */

export type SoloId = 'oddone'

export type SoloApi = {
  /** Report the running score. The shell displays it and keeps the best. */
  setScore: (score: number) => void
  /** End the run and show the result. */
  end: () => void
}

export type SoloMeta = {
  id: SoloId
  title: string
  rule: string
  /** Whether a bigger number is better. Time-scored games would use 'low'. */
  direction: 'high' | 'low'
  /** Shown after the number on the result card, e.g. "levels". */
  unit: string
}

export type SoloModule = {
  meta: SoloMeta
  Play: ComponentType<{ api: SoloApi }>
}
