import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import { EV_RESULT, EV_SHOT, GRID, alreadyShot, makeFleet, replay } from './logic'
import type { SalvoState } from './logic'

/**
 * The bot keeps its own fleet in a closure — the same rule the human client
 * follows, so ship positions never reach the log from either side.
 *
 * It hunts at random until it lands a hit, then works the neighbours of that
 * hit, which is roughly how a person plays and makes it beatable but not daft.
 */
export const salvoBot: BotFactory = () => {
  let fleet: number[] | null = null
  let pendingFor = -1

  const neighbours = (i: number): number[] => {
    const x = i % GRID
    const y = Math.floor(i / GRID)
    const out: number[] = []
    if (x > 0) out.push(i - 1)
    if (x < GRID - 1) out.push(i + 1)
    if (y > 0) out.push(i - GRID)
    if (y < GRID - 1) out.push(i + GRID)
    return out
  }

  return {
    react(gameEvents, api, ctx) {
      const state: SalvoState = replay(gameEvents, {
        seed: ctx.seed,
        startedAt: ctx.startedAt,
        slot: 'guest',
      })
      if (state.phase === 'over') return
      if (!fleet) fleet = makeFleet(mulberry32(ctx.seed ^ 0x51a1))

      const rand = mulberry32(ctx.seed + gameEvents.length * 3_571)

      // Answering an incoming shot takes priority over taking its own.
      if (state.pending && state.pending.by === 'host') {
        if (pendingFor === gameEvents.length) return
        pendingFor = gameEvents.length
        const hit = fleet.includes(state.pending.i)
        api.emit(EV_RESULT, { i: state.pending.i, hit }, 420 + Math.floor(rand() * 380))
        return
      }

      if (state.pending || state.turn !== 'guest') return
      if (pendingFor === gameEvents.length) return
      pendingFor = gameEvents.length

      const mine = state.shots.guest
      const open = (i: number) => !alreadyShot(state, 'guest', i)

      // Work outwards from an unfinished hit if there is one.
      const live = mine.filter((s) => s.hit).flatMap((s) => neighbours(s.i)).filter(open)
      let target: number
      if (live.length && rand() > 0.12) {
        target = live[Math.floor(rand() * live.length)]
      } else {
        const all: number[] = []
        for (let i = 0; i < GRID * GRID; i++) if (open(i)) all.push(i)
        if (!all.length) return
        target = all[Math.floor(rand() * all.length)]
      }

      api.emit(EV_SHOT, { i: target }, 700 + Math.floor(rand() * 500))
    },
  }
}
