import type { GameModule } from '../types'
import { shiftBot } from './bot'
import { init, reduce } from './logic'
import type { ShiftState } from './logic'
import { ShiftView } from './View'

export const shiftGame: GameModule<ShiftState> = {
  meta: {
    id: 'shift',
    title: 'Shift',
    rule: 'Tic-tac-toe where you only ever own three pieces — your fourth removes your oldest.',
    format: 'First to 2',
  },
  init,
  reduce,
  bot: shiftBot,
  View: ShiftView,
}
