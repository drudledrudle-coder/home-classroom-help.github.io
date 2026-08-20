import type { ComponentType } from 'react'

/**
 * Solo score games are deliberately *not* built on the room engine. There is no
 * opponent, so there is nothing to synchronise, no log to replay and no seed to
 * agree on — forcing them through the versus machinery would add a sequencer to
 * a game that only ever runs in one browser.
 */

export type SoloId = 'oddone' | 'merge' | 'snake' | 'stack' | 'roll' | 'recall'

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
  /**
   * The board waits for the player's first input before anything happens, so it
   * supplies its own beat and must not get a countdown in front of its prompt.
   */
  selfStart?: boolean
  /** Shown after the number on the result card, e.g. "levels". */
  unit: string
}

export type SoloModule = {
  meta: SoloMeta
  Play: ComponentType<{
    api: SoloApi
    /**
     * Whether the run's clock is live.
     *
     * False during the opening 3-2-1, and false again whenever the player
     * pauses. Both are the same requirement from the board's side: stop
     * advancing, and do not schedule anything that would advance later.
     *
     * Locking input is not enough on its own. A board that runs its *own* clock
     * keeps running behind an overlay — the player watches Recall play a
     * sequence they cannot answer, or a paused Snake walks into a wall while
     * the settings are open. Any game with a timer, an interval or a
     * self-scheduling loop must gate it on this. Games that only ever react to
     * input can ignore it, since input is blocked for them anyway.
     *
     * Resuming must not hand out free progress either: a level timer has to
     * carry its remaining time across the pause rather than restart.
     *
     * Always true for `selfStart` games until the player pauses, since they
     * have no count in front of them.
     */
    running: boolean
  }>
}
