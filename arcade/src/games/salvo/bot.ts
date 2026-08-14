import { scale } from '../../lib/difficulty'
import { mulberry32 } from '../../lib/random'
import type { BotFactory } from '../../net/botTransport'
import {
  EV_READY,
  EV_RESULT,
  EV_SHOT,
  GRID,
  alreadyShot,
  bothReady,
  makeFleet,
  regroup,
  replay,
  sunkBy,
} from './logic'
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
  /** Its own fleet split into vessels, so it knows when one has been finished. */
  let ships: number[][] | null = null
  let pendingFor = -1
  let readySent = false

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

      // Its fleet is already down; it just has to say so. A short beat, so the
      // opponent's "ready" does not land before the player has read the screen.
      if (!state.ready.guest) {
        if (readySent) return
        readySent = true
        api.emit(EV_READY, undefined, 500 + Math.floor(rand() * 400))
        return
      }
      if (!bothReady(state)) return

      // Answering an incoming shot takes priority over taking its own.
      if (state.pending && state.pending.by === 'host') {
        if (pendingFor === gameEvents.length) return
        pendingFor = gameEvents.length
        const i = state.pending.i
        const hit = fleet.includes(i)
        // Report a sinking the same way a human client does, or solo play would
        // be the one mode where finishing a ship went unremarked.
        if (!ships) ships = regroup(fleet)
        const struck = new Set(state.shots.host.filter((s) => s.hit).map((s) => s.i))
        const sunk = hit ? (sunkBy(ships, struck, i) ?? undefined) : undefined
        api.emit(EV_RESULT, { i, hit, sunk }, 420 + Math.floor(rand() * 380))
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
      // How reliably it follows up a hit instead of firing at random.
      const focus = scale(ctx.difficulty, 0.45, 0.96)
      if (live.length && rand() < focus) {
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
