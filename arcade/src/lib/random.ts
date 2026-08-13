/**
 * Deterministic PRNG. Both clients seed from the same number published in the
 * `match:game` event, so dot positions, letter racks and reaction delays are
 * identical on both screens without the server generating any of them.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

/** Fisher-Yates against a supplied PRNG, so shuffles stay reproducible. */
export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
