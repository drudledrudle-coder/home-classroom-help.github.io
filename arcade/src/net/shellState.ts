import type { GameId, MatchEvent, Slot } from '../../shared/protocol'

/* Shell-owned event types. Everything else belongs to the active game. */
export const EV_GAME = 'match:game'
export const EV_READY = 'match:ready'
export const EV_START = 'match:start'
export const EV_TIMEUP = 'match:timeup'

export type ShellState = {
  gameId: GameId | null
  seed: number
  startedAt: number
  ready: Record<Slot, boolean>
  /** Index of the most recent match:start; game events are everything after. */
  startIndex: number
}

/**
 * Replays the shell-level events. Reading forward (rather than searching
 * backwards) means a rematch simply overwrites the earlier selection, so the
 * log never needs clearing between games in the same room.
 *
 * Shared by the React hook and the bot transport so solo and online play
 * interpret an identical log the same way.
 */
export function readShellState(log: MatchEvent[]): ShellState {
  const out: ShellState = {
    gameId: null,
    seed: 0,
    startedAt: 0,
    ready: { host: false, guest: false },
    startIndex: -1,
  }

  for (let i = 0; i < log.length; i++) {
    const ev = log[i]
    if (ev.type === EV_GAME) {
      const data = ev.data as { gameId: GameId | null; seed: number } | undefined
      out.gameId = data?.gameId ?? null
      out.seed = data?.seed ?? 0
      out.startedAt = 0
      out.startIndex = -1
      out.ready = { host: false, guest: false }
    } else if (ev.type === EV_READY) {
      if (ev.from !== 'system') out.ready[ev.from] = true
    } else if (ev.type === EV_START) {
      out.startedAt = ev.at
      out.startIndex = i
    }
  }

  return out
}
