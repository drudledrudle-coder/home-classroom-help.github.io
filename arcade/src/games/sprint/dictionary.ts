import { mulberry32, shuffle } from '../../lib/random'

/**
 * The word list is a lazy chunk — about 83KB gzipped — so it only downloads
 * when someone actually picks Word Sprint. Both clients load the same list,
 * which is what lets validation live in the shared reducer: an invalid word is
 * rejected by the *opponent's* client too, so a tampered client cannot score
 * with nonsense.
 */

export const RACK_SIZE = 7
export const MIN_WORD = 3

/** Length -> points. Steep enough that a single long word is worth chasing. */
const POINTS = [0, 0, 0, 1, 2, 4, 7, 12]

let words: Set<string> | null = null
let racks: string[] | null = null
let loading: Promise<void> | null = null

/** Reverses the front-coding done by scripts/generate-wordlist.mjs. */
function decode(encoded: string): Set<string> {
  const out = new Set<string>()
  let prev = ''
  let i = 0
  while (i < encoded.length) {
    const shared = encoded.charCodeAt(i) - 48
    i += 1
    let j = i
    // Suffix runs until the next prefix-length marker, which is below 'a'.
    while (j < encoded.length && encoded.charCodeAt(j) >= 97) j += 1
    const word = prev.slice(0, shared) + encoded.slice(i, j)
    out.add(word)
    prev = word
    i = j
  }
  return out
}

export function loadDictionary(): Promise<void> {
  if (words) return Promise.resolve()
  if (loading) return loading

  loading = Promise.all([import('./data/words.txt?raw'), import('./data/racks.txt?raw')]).then(
    ([wordsModule, racksModule]) => {
      words = decode(wordsModule.default)
      const flat = racksModule.default.trim()
      racks = []
      for (let i = 0; i + RACK_SIZE <= flat.length; i += RACK_SIZE) {
        racks.push(flat.slice(i, i + RACK_SIZE))
      }
    },
  )

  return loading
}

export const isReady = (): boolean => words !== null

export function isWord(word: string): boolean {
  return words?.has(word) ?? false
}

/** All words the rack can spell. Used by the bot to plan a round. */
export function spellableWords(letters: string[]): string[] {
  if (!words) return []
  const out: string[] = []
  for (const word of words) {
    if (word.length >= MIN_WORD && spellable(word, letters)) out.push(word)
  }
  return out
}

export function rackFor(seed: number): string[] {
  if (!racks || !racks.length) return []
  const pick = racks[Math.abs(seed) % racks.length]
  // Shuffled so the source word is not sitting there in plain sight.
  return shuffle(pick.split(''), mulberry32(seed + 7))
}

/** Multiset containment: each tile may be spent once per word. */
export function spellable(word: string, letters: string[]): boolean {
  const pool = letters.slice()
  for (const ch of word) {
    const at = pool.indexOf(ch)
    if (at < 0) return false
    pool.splice(at, 1)
  }
  return true
}

export function scoreOf(word: string): number {
  return POINTS[word.length] ?? 0
}
