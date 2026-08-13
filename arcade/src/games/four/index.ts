import type { GameModule } from '../types'
import { fourBot } from './bot'
import { init, reduce } from './logic'
import type { FourState } from './logic'
import { FourView } from './View'

export const fourGame: GameModule<FourState> = {
  meta: {
    id: 'four',
    title: 'Four',
    rule: 'Drop a piece into a column and get four in a row in any direction.',
    format: 'First to 2',
  },
  init,
  reduce,
  bot: fourBot,
  View: FourView,
}
