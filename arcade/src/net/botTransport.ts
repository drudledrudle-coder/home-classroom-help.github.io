import type { GameId, MatchEvent } from '../../shared/protocol'
import { currentDifficulty } from '../lib/difficulty'
import type { Difficulty } from '../lib/difficulty'
import { EV_READY, readShellState } from './shellState'
import type { Transport, TransportState } from './types'

export type BotApi = {
  /** Append an event as the opponent, optionally after a human-ish delay. */
  emit: (type: string, data?: unknown, delayMs?: number) => void
  now: () => number
}

export type BotCtx = {
  seed: number
  startedAt: number
  /**
   * How hard to play, 1..5. Read fresh on every reaction rather than captured
   * when the brain is built, so changing the slider between games takes effect
   * without rebuilding anything.
   */
  difficulty: Difficulty
}

/**
 * A bot is just another event source. It sees the same log and writes to the
 * same log, so every game's reducer and view work unchanged in solo mode —
 * there is no `if (isBot)` branch anywhere in the game code.
 *
 * `react` is called after every change to the log and may be called many times
 * for the same state, so brains must track what they have already answered.
 */
export type BotBrain = {
  react: (gameEvents: MatchEvent[], api: BotApi, ctx: BotCtx) => void
  dispose?: () => void
}

export type BotFactory = () => BotBrain

/** Delay before the bot accepts a game, so solo play does not feel instantaneous. */
const BOT_READY_DELAY_MS = 420

export function createBotTransport(pick: (id: GameId) => BotFactory | null): Transport {
  const listeners = new Set<(s: TransportState) => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()

  let brain: BotBrain | null = null
  let brainFor: GameId | null = null
  let readiedFor = -1
  let seq = 0
  let running = false

  const now = () => Date.now()

  let state: TransportState = {
    conn: { phase: 'live' },
    code: 'SOLO',
    slot: 'host',
    epoch: 1,
    events: [],
    pending: [],
    // The bot never disconnects, so presence is pinned on.
    peers: { host: { joined: true, lastSeen: now() }, guest: { joined: true, lastSeen: now() } },
    clockOffset: 0,
  }

  const emit = () => {
    const snapshot = state
    listeners.forEach((fn) => fn(snapshot))
  }

  const later = (fn: () => void, delayMs: number) => {
    if (delayMs <= 0) {
      fn()
      return
    }
    const t = setTimeout(() => {
      timers.delete(t)
      if (running) fn()
    }, delayMs)
    timers.add(t)
  }

  const append = (from: 'host' | 'guest', type: string, data?: unknown) => {
    seq += 1
    const event: MatchEvent = { seq, at: now(), from, type, data }
    state = {
      ...state,
      events: [...state.events, event],
      peers: { host: { joined: true, lastSeen: now() }, guest: { joined: true, lastSeen: now() } },
    }
    emit()
    step()
  }

  const api: BotApi = {
    emit: (type, data, delayMs = 0) => later(() => append('guest', type, data), delayMs),
    now,
  }

  // Re-entrancy guard: appending inside step() would otherwise recurse.
  let stepping = false

  function step() {
    if (stepping || !running) return
    stepping = true
    try {
      const shell = readShellState(state.events)

      // Swap brains when the selected game changes, and drop any pending
      // actions the previous brain had queued.
      if (shell.gameId !== brainFor) {
        brain?.dispose?.()
        timers.forEach(clearTimeout)
        timers.clear()
        brainFor = shell.gameId
        brain = shell.gameId ? (pick(shell.gameId)?.() ?? null) : null
        readiedFor = -1
      }

      if (!brain || !shell.gameId) return

      // Readying up is shell behaviour, identical for every game.
      if (!shell.ready.guest && readiedFor !== shell.seed) {
        readiedFor = shell.seed
        later(() => append('guest', EV_READY), BOT_READY_DELAY_MS)
        return
      }

      if (shell.startIndex < 0) return

      brain.react(state.events.slice(shell.startIndex + 1), api, {
        seed: shell.seed,
        startedAt: shell.startedAt,
        difficulty: currentDifficulty(),
      })
    } finally {
      stepping = false
    }
  }

  return {
    kind: 'bot',
    getState: () => state,

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    push(type, data) {
      if (!running) return
      append('host', type, data)
    },

    async reset() {
      timers.forEach(clearTimeout)
      timers.clear()
      brain?.dispose?.()
      brain = null
      brainFor = null
      readiedFor = -1
      seq = 0
      state = { ...state, epoch: state.epoch + 1, events: [], pending: [] }
      emit()
      step()
    },

    setTempo() {
      // No network, nothing to pace.
    },

    start() {
      running = true
      step()
    },

    stop() {
      running = false
      timers.forEach(clearTimeout)
      timers.clear()
      brain?.dispose?.()
      listeners.clear()
    },
  }
}
