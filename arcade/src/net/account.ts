import { useCallback, useEffect, useState } from 'react'
import type { Boards, Me, ScoreErrorCode, ScoreReq, ScoreRes } from '../../shared/scores'
import { gateHeaders } from './gate'

/**
 * Signing in, and the boards.
 *
 * The sign-in key is used once, exchanged for a token, and never kept — so a
 * shared phone does not leave someone's key sitting in storage where the next
 * player can read it out of devtools. The token expires on its own and only
 * ever proves *which account* you are.
 */

const ENDPOINT = '/api/scores'
const TOKEN_KEY = 'arcade.player.token'
const ME_KEY = 'arcade.player.me'

export type { Boards, Me }

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function storedMe(): Me | null {
  try {
    const raw = localStorage.getItem(ME_KEY)
    return raw ? (JSON.parse(raw) as Me) : null
  } catch {
    return null
  }
}

function remember(token: string | null, me: Me | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me))
    else localStorage.removeItem(ME_KEY)
  } catch {
    /* storage disabled; the session still holds for this page */
  }
}

async function call(req: ScoreReq): Promise<ScoreRes> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...gateHeaders() },
      body: JSON.stringify(req),
    })
    return (await res.json()) as ScoreRes
  } catch {
    // Offline, or the endpoint is missing on an older deploy. Neither is worth
    // an error screen over a leaderboard.
    return { ok: false, error: 'CONFLICT', message: 'offline' }
  }
}

export const signedIn = (): boolean => storedToken() !== null
export const currentUser = (): Me | null => storedMe()

export async function fetchBoards(): Promise<Boards | null> {
  const res = await call({ op: 'boards' })
  return res.ok ? { games: res.games, champions: res.champions } : null
}

export type SignInResult =
  | { ok: true; me: Me; boards: Boards }
  | { ok: false; error: ScoreErrorCode }

export async function signIn(key: string): Promise<SignInResult> {
  const res = await call({ op: 'signin', key: key.trim() })
  if (!res.ok) return { ok: false, error: res.error }
  if (!res.token || !res.me) return { ok: false, error: 'BAD_KEY' }

  remember(res.token, res.me)
  return { ok: true, me: res.me, boards: { games: res.games, champions: res.champions } }
}

export async function claimName(
  name: string,
  uid?: string,
): Promise<{ ok: true; me: Me; boards: Boards } | { ok: false; error: ScoreErrorCode }> {
  const token = storedToken()
  if (!token) return { ok: false, error: 'BAD_TOKEN' }

  const res = await call({ op: 'name', token, name, uid })
  if (!res.ok) return { ok: false, error: res.error }
  if (res.me) remember(token, res.me)
  return {
    ok: true,
    me: res.me ?? (storedMe() as Me),
    boards: { games: res.games, champions: res.champions },
  }
}

export function signOut(): void {
  remember(null, null)
}

/**
 * Post a finished run.
 *
 * Deliberately silent and best effort. A leaderboard is a nice-to-have on top
 * of a game that has already been played, so nothing here is allowed to
 * interrupt the result screen — a failed post just means the run is not on the
 * board, and the next better run will post again anyway.
 */
export async function submitScore(game: string, score: number): Promise<Boards | null> {
  const token = storedToken()
  const me = storedMe()
  if (!token || !me?.name) return null

  const res = await call({ op: 'submit', token, game, score })
  if (!res.ok) {
    // The token has expired or the keys were rotated. Drop it rather than
    // retrying forever with something that cannot work.
    if (res.error === 'BAD_TOKEN') signOut()
    return null
  }
  return { games: res.games, champions: res.champions }
}

/** The signed-in player, kept in sync across screens. */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(storedMe)

  useEffect(() => {
    const sync = () => setMe(storedMe())
    window.addEventListener('arcade:account', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('arcade:account', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return me
}

/** Raised after any change to the session, so every screen can follow it. */
export function announceAccount(): void {
  window.dispatchEvent(new Event('arcade:account'))
}

export function useBoards(): {
  boards: Boards | null
  loading: boolean
  reload: () => void
  apply: (next: Boards) => void
} {
  const [boards, setBoards] = useState<Boards | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    void fetchBoards().then((next) => {
      setBoards(next)
      setLoading(false)
    })
  }, [])

  useEffect(reload, [reload])

  return { boards, loading, reload, apply: setBoards }
}
