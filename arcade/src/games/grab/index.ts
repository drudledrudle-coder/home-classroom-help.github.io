import type { GameModule } from '../types'
import { grabBot } from './bot'
import { DURATION_MS, init, reduce } from './logic'
import type { GrabState } from './logic'
import { GrabView } from './View'

export const grabGame: GameModule<GrabState> = {
  meta: {
    id: 'grab',
    title: 'Dot Grab',
    rule: 'Dots pop up on a shared board — tap to claim them, most dots when time runs out wins.',
    format: '30 seconds',
    durationMs: DURATION_MS,
  },
  init,
  reduce,
  bot: grabBot,
  View: GrabView,
}
