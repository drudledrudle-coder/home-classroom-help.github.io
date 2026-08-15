import { useCallback, useEffect, useState } from 'react'
import { MAX_SYNC } from '../../shared/scores'
import type { Boards, Me, Run, ScoreErrorCode, ScoreReq, ScoreRes } from '../../shared/scores'

/**
 * Who you are, and everything that depends on it.
 *
 * Signing in is the only thing the key is used for: it goes out once, comes
 * back as a token, and is never kept — so a shared phone does not leave
 * somebody's key sitting in storage where the next player can read it out of
 * devtools. The token only ever proves *which account* you are, expires on its
 * own, and stops working the moment the keys are rotated.
 *
 * The token is kept in localStorage rather than sessionStorage because it is
 * now the login for the whole app. A player who closes the tab and comes back
 * should still be signed in; being asked for the key on every visit is exactly
 * the friction that would have people sharing it around.
 */

const ENDPOINT = '/api/scores'
const TOKEN_KEY = 'arcade.session'
const ME_KEY = 'arcade.player.me'
const QUEUE_KEY = 'arcade.pending'

export type { Boards, Me }

function readLocal(name: string): string | null {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

function writeLocal(name: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(name)
    else localStorage.setItem(name, value)
  } catch {
    /* storage disabled; the session still holds for this page */
  }
}

const storedToken = (): string | null => readLocal(TOKEN_KEY)

function storedMe(): Me | null {
  try {
    const raw = readLocal(ME_KEY)
    return raw ? (JSON.parse(raw) as Me) : null
  } catch {
    return null
  }
}

function remember(token: string | null, me: Me | null): void {
  writeLocal(TOKEN_KEY, token)
  writeLocal(ME_KEY, me ? JSON.stringify(me) : null)
}

async function call(req: ScoreReq): Promise<ScoreRes> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

/** True once this account can actually play: signed in, and someone. */
export const ready = (): boolean => {
  const me = storedMe()
  return signedIn() && !!me && (me.name !== null || me.admin)
}

/** Header the room API is guarded by. The session is the key to everything. */
export function authHeaders(): Record<string, string> {
  const token = storedToken()
  return token ? { 'x-arcade-token': token } : {}
}

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
  // A returning player may have runs banked from an offline session.
  void flushPending()
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

  // An admin renaming somebody else must not overwrite their own identity with
  // the response, so only a claim for this account is remembered.
  if (res.me && !uid) {
    remember(token, res.me)
    // The first thing a new name unlocks is posting, and there may already be a
    // queue: offline play is allowed before the name is claimed.
    void flushPending()
  }

  return {
    ok: true,
    me: res.me ?? (storedMe() as Me),
    boards: { games: res.games, champions: res.champions },
  }
}

export function signOut(): void {
  remember(null, null)
}

/* -- posting runs ---------------------------------------------------------- */

/**
 * Runs that have not reached the board yet.
 *
 * Kept as one best-per-game rather than a log. The board only ever records an
 * improvement, so a worse queued run is already dead weight — and collapsing
 * them means a week offline still syncs in one small request rather than
 * hundreds of pointless ones.
 */
function queue(): Run[] {
  try {
    const raw = readLocal(QUEUE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is Run =>
        !!r && typeof r === 'object' && typeof r.game === 'string' && Number.isFinite(r.score),
    )
  } catch {
    return []
  }
}

function bank(game: string, score: number): void {
  const runs = queue()
  const existing = runs.find((r) => r.game === game)
  if (existing) {
    if (score <= existing.score) return
    existing.score = score
  } else {
    runs.push({ game, score })
  }
  writeLocal(QUEUE_KEY, JSON.stringify(runs.slice(-MAX_SYNC)))
}

export const pendingCount = (): number => queue().length

/**
 * Drain the queue in one write.
 *
 * Only cleared on a confirmed success. Anything else — offline, a server hiccup
 * — leaves the runs banked for the next attempt, which is the entire point of
 * having a queue.
 */
export async function flushPending(): Promise<Boards | null> {
  const token = storedToken()
  const me = storedMe()
  const runs = queue()
  if (!token || !me?.name || runs.length === 0) return null

  const res = await call({ op: 'sync', token, runs })
  if (!res.ok) {
    if (res.error === 'BAD_TOKEN') signOut()
    return null
  }

  writeLocal(QUEUE_KEY, null)
  announceAccount()
  return { games: res.games, champions: res.champions }
}

/**
 * Post a finished run.
 *
 * Deliberately silent and best effort. A leaderboard is a nice-to-have on top
 * of a game that has already been played, so nothing here is allowed to
 * interrupt the result screen — a failed post is banked and goes up with the
 * next one, or when the network comes back.
 */
export async function submitScore(game: string, score: number): Promise<Boards | null> {
  const token = storedToken()
  const me = storedMe()

  // No name yet — offline first run, most likely. Bank it; claiming the name
  // flushes the queue.
  if (!token || !me?.name) {
    bank(game, score)
    return null
  }

  // Anything already waiting goes up with this run, in a single write.
  const runs = queue()
  const res =
    runs.length > 0
      ? await call({ op: 'sync', token, runs: mergeRun(runs, game, score) })
      : await call({ op: 'submit', token, game, score })

  if (!res.ok) {
    // The token expired or the keys were rotated. Drop it rather than retrying
    // forever with something that cannot work — but keep the run, because the
    // player will sign in again and it should still count.
    if (res.error === 'BAD_TOKEN') signOut()
    bank(game, score)
    return null
  }

  writeLocal(QUEUE_KEY, null)
  return { games: res.games, champions: res.champions }
}

function mergeRun(runs: Run[], game: string, score: number): Run[] {
  const merged = runs.map((r) => ({ ...r }))
  const existing = merged.find((r) => r.game === game)
  if (!existing) merged.push({ game, score })
  else if (score > existing.score) existing.score = score
  return merged.slice(-MAX_SYNC)
}

/**
 * Flush whenever the network comes back, and once on start.
 *
 * Registered at module scope rather than from a component so it survives every
 * screen change — a run banked in Snake should go up even if the player never
 * opens the leaderboard.
 */
export function watchForReconnect(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => void flushPending())
  void flushPending()
}

/* -- hooks ----------------------------------------------------------------- */

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
