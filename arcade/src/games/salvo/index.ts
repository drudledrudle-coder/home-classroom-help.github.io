import type { GameModule } from '../types'
import { salvoBot } from './bot'
import { init, reduce } from './logic'
import type { SalvoState } from './logic'
import { SalvoView } from './View'

export const salvoGame: GameModule<SalvoState> = {
  meta: {
    id: 'salvo',
    title: 'Salvo',
    rule: 'Three ships are hidden in their waters — find and sink them all, and a hit earns another shot.',
    format: 'Sink all 3',
  },
  init,
  reduce,
  bot: salvoBot,
  View: SalvoView,
}
