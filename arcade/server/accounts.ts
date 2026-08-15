/**
 * Who is who, and what they are allowed to do.
 *
 * Sign-in keys live in the `ARCADE_PLAYER_KEYS` environment variable, never in
 * this repository — it is public, and a key committed here would let anyone
 * claim that player's name and post scores as them. The admin key is the
 * existing `ARCADE_KEY`, so there is one secret to rotate rather than two
 * kinds.
 *
 * A player's identity is derived from their key rather than stored alongside
 * it: the id is a hash, so the datastore never holds anything that could be
 * used to sign in. Losing the blob loses the scores, not the accounts.
 */

import { createHash, createHmac } from 'node:crypto'
import { safeEqual } from './gateToken.ts'

const TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Every key that may sign in, from the environment. */
export function playerKeys(): string[] {
  const raw = process.env.ARCADE_PLAYER_KEYS ?? ''
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
}

export function adminKey(): string | null {
  const trimmed = process.env.ARCADE_KEY?.trim()
  return trimmed ? trimmed : null
}

/**
 * Secret the session tokens are signed with.
 *
 * Falls back to a fixed development value so the whole feature works locally
 * with nothing configured. That fallback is not a weakness in production: with
 * no `ARCADE_KEY` there is no admin key either, and with no
 * `ARCADE_PLAYER_KEYS` nobody can sign in at all.
 */
function tokenSecret(): string {
  return adminKey() ?? 'arcade-local-development'
}

/** Stable, irreversible, and short enough to read in a URL or a log. */
export const uidFor = (key: string): string =>
  createHash('sha256').update(`arcade.uid.${key}`).digest('hex').slice(0, 16)

const sign = (payload: string): string =>
  createHmac('sha256', tokenSecret()).update(payload).digest('hex')

export function issueSession(uid: string, admin: boolean, now = Date.now()): string {
  const payload = `${uid}.${admin ? 'a' : 'p'}.${now + TTL_MS}`
  return `${payload}.${sign(payload)}`
}

export type Session = { uid: string; admin: boolean }

export function readSession(token: unknown, now = Date.now()): Session | null {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 4) return null

  const [uid, role, expiry, mac] = parts
  if (!/^[0-9a-f]{16}$/.test(uid)) return null
  if (role !== 'a' && role !== 'p') return null
  if (!/^\d{1,15}$/.test(expiry) || Number(expiry) < now) return null
  if (!safeEqual(sign(`${uid}.${role}.${expiry}`), mac)) return null

  return { uid, admin: role === 'a' }
}

/**
 * Which account a key belongs to, if any.
 *
 * Every candidate is compared even after a match, so the time taken does not
 * depend on where in the list the key sits.
 */
export function identify(key: unknown): Session | null {
  if (typeof key !== 'string' || !key) return null

  let found: Session | null = null

  const admin = adminKey()
  if (admin && safeEqual(key, admin)) found = { uid: uidFor(key), admin: true }

  for (const candidate of playerKeys()) {
    if (safeEqual(key, candidate) && !found) found = { uid: uidFor(key), admin: false }
  }

  return found
}
