/**
 * The one primitive every secret in this app is compared with.
 *
 * This file used to be `gateToken.ts` and issued a second kind of token: a site
 * key that opened the door, separate from the player key that said who you
 * were. Those have been merged — see `login.ts` — so all that survives is the
 * comparison, which `accounts.ts` uses to check a key and a signature.
 */

import { timingSafeEqual } from 'node:crypto'

/** Comparison that does not leak how much of the value matched. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on a length mismatch, so that has to be checked
  // first — which is fine, since length is not the secret.
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
