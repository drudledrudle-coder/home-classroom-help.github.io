import type { GameModule } from '../types'
import { nerveBot } from './bot'
import { init, reduce } from './logic'
import type { NerveState } from './logic'
import { NerveView } from './View'

export const nerveGame: GameModule<NerveState> = {
  meta: {
    id: 'nerve',
    title: 'Nerve',
    rule: 'Flip tiles for points and bank them before you hit the bomb that takes the lot.',
    format: 'First to 30',
  },
  init,
  reduce,
  bot: nerveBot,
  View: NerveView,
}
