import type { GameModule } from '../types'
import { tugBot } from './bot'
import { DURATION_MS, init, reduce } from './logic'
import type { TugState } from './logic'
import { TugView } from './View'

export const tugGame: GameModule<TugState> = {
  meta: {
    id: 'tug',
    title: 'Tug',
    rule: 'Tap as fast as you can and drag the marker onto your side before the ten seconds run out.',
    format: '10 seconds',
    durationMs: DURATION_MS,
  },
  init,
  reduce,
  bot: tugBot,
  View: TugView,
}
