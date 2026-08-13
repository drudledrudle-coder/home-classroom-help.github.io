import type { GameModule } from '../types'
import { reactionBot } from './bot'
import { init, reduce } from './logic'
import type { ReactionState } from './logic'
import { ReactionView } from './View'

export const reactionGame: GameModule<ReactionState> = {
  meta: {
    id: 'reaction',
    title: 'Reaction Duel',
    rule: 'When the screen flips colour, tap first — but tap early and you lose the round.',
    format: 'Best of 5',
  },
  init,
  reduce,
  bot: reactionBot,
  View: ReactionView,
}
