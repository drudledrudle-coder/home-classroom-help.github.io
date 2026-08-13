import type { GameModule } from '../types'
import { sprintBot } from './bot'
import { loadDictionary } from './dictionary'
import { DURATION_MS, init, reduce } from './logic'
import type { SprintState } from './logic'
import { SprintView } from './View'

export const sprintGame: GameModule<SprintState> = {
  meta: {
    id: 'sprint',
    title: 'Word Sprint',
    rule: 'Same seven letters for both of you — spell the most words before the clock runs out.',
    format: '60 seconds',
    durationMs: DURATION_MS,
  },
  init,
  reduce,
  bot: sprintBot,
  View: SprintView,
  prepare: loadDictionary,
}
