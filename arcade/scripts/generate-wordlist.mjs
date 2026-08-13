/**
 * Builds the two assets Word Sprint needs, from the `word-list` dev dependency.
 * Run with `npm run gen:words`. The outputs are committed, so a normal build and
 * the deployed site never depend on this script.
 *
 *  1. words.txt  — every 3-7 letter word, front-coded.
 *     The list is sorted, so consecutive entries share long prefixes. Storing
 *     "shared prefix length + suffix" instead of the whole word takes the
 *     payload from 175KB gzipped to about 83KB, which is the difference between
 *     an unreasonable lazy chunk and an acceptable one.
 *
 *  2. racks.txt  — 400 seven-letter racks, richest first.
 *     Picking a rack at random from the dictionary tends to produce obscure
 *     letters and a miserable round. Instead each candidate is scored by how
 *     many dictionary words its letters can spell, and only the top slice is
 *     kept. Every rack is guaranteed to contain at least one seven-letter word
 *     (itself) plus a deep pool of shorter ones.
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, '..', 'src', 'games', 'sprint', 'data')
const source = path.join(here, '..', 'node_modules', 'word-list', 'words.txt')

const RACK_SIZE = 7
const RACK_COUNT = 400

const words = fs
  .readFileSync(source, 'utf8')
  .split('\n')
  .filter((w) => /^[a-z]{3,7}$/.test(w))
  .sort()

console.log(`dictionary: ${words.length} words (3-${RACK_SIZE} letters)`)

/* -- 1. front-code the dictionary ----------------------------------------- */

let encoded = ''
let prev = ''
for (const word of words) {
  let shared = 0
  const max = Math.min(prev.length, word.length)
  while (shared < max && prev[shared] === word[shared]) shared++
  encoded += String.fromCharCode(48 + shared) + word.slice(shared)
  prev = word
}

/* -- 2. rank racks by how much they can spell ------------------------------ */

const maskOf = (word) => {
  let mask = 0
  for (const ch of word) mask |= 1 << (ch.charCodeAt(0) - 97)
  return mask
}

// Collapse the dictionary to distinct letter-sets so the scoring loop runs
// against ~30k masks instead of ~75k words.
const weight = new Map()
for (const word of words) {
  const mask = maskOf(word)
  weight.set(mask, (weight.get(mask) ?? 0) + 1)
}
const masks = [...weight.keys()]
const counts = [...weight.values()]

const candidates = words.filter((w) => w.length === RACK_SIZE && new Set(w).size === RACK_SIZE)
console.log(`rack candidates: ${candidates.length}`)

const scored = candidates.map((word) => {
  const rack = maskOf(word)
  let score = 0
  for (let i = 0; i < masks.length; i++) {
    if ((masks[i] & ~rack) === 0) score += counts[i]
  }
  return { word, score }
})

scored.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
const racks = scored.slice(0, RACK_COUNT)

console.log(
  `racks: keeping ${racks.length}, richest "${racks[0].word}" (${racks[0].score} spellable), ` +
    `leanest "${racks.at(-1).word}" (${racks.at(-1).score})`,
)

/* -- 3. write ------------------------------------------------------------- */

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'words.txt'), encoded)
fs.writeFileSync(path.join(outDir, 'racks.txt'), racks.map((r) => r.word).join(''))

const gz = (s) => (zlib.gzipSync(s).length / 1024).toFixed(1)
console.log(`words.txt  ${(encoded.length / 1024).toFixed(1)}KB raw, ${gz(encoded)}KB gzipped`)
console.log(`racks.txt  ${racks.length * RACK_SIZE} bytes`)
