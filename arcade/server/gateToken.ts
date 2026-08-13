/**
 * Site access key.
 *
 * The key is read from the ARCADE_KEY environment variable and is only ever
 * compared inside a serverless function — it is never sent to the browser and
 * never appears in the built bundle, so it cannot be read out of page source.
 *
 * Unlocking returns a short-lived HMAC token rather than storing a session
 * anywhere: the token is signed with the key itself, so it can be verified on
 * later requests with no database and it stops being valid the moment the key
 * is changed. Changing the key therefore logs everyone out, which is the
 * behaviour you want from a shared password.
 *
 * When ARCADE_KEY is unset the whole gate is disabled. That keeps local dev
 * frictionless and means a missing variable degrades to "open" rather than
 * bricking the site.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL_MS = 12 * 60 * 60 * 1000

export function siteKey(): string | null {
  const raw = process.env.ARCADE_KEY
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('hex')
}

export function issueToken(key: string, now: number = Date.now()): string {
  const expiry = String(now + TTL_MS)
  return `${expiry}.${sign(expiry, key)}`
}

export function verifyToken(
  token: string | null | undefined,
  key: string,
  now: number = Date.now(),
): boolean {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot < 1) return false

  const expiry = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  if (!/^\d{1,15}$/.test(expiry) || Number(expiry) < now) return false

  return safeEqual(sign(expiry, key), mac)
}

/** Comparison that does not leak how much of the value matched. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on a length mismatch, so that has to be checked
  // first — which is fine, since length is not the secret.
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Fixed pause on a wrong key. Without a datastore there is nowhere to count
 * attempts per address, so this is a deliberate floor on guess rate: it caps a
 * single attacker at a couple of guesses a second.
 */
export const WRONG_KEY_DELAY_MS = 450

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
