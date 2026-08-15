/**
 * Accounts and leaderboards.
 *
 * The trust model is the same one Salvo's fleets run on, and worth stating
 * plainly: **scores are reported by the client, so they can be forged.** There
 * is no way around that without running every game on the server, which is not
 * a trade worth making for a thing you play with friends. The server clamps
 * absurd values and stops one person overwriting another's row; it cannot tell
 * a real 400 from a typed one.
 *
 * What *is* enforced: you cannot post as somebody else, and you cannot take a
 * name that is already taken. Those are the parts where being wrong would spoil
 * the board for everyone rather than just flatter one person.
 */

/** Games with a score worth ranking. Versus games have no single number. */
export const LEADERBOARD_GAMES = [
  'merge',
  'snake',
  'stack',
  'roll',
  'recall',
  'oddone',
] as const

export type BoardGame = (typeof LEADERBOARD_GAMES)[number]

export const isBoardGame = (v: unknown): v is BoardGame =>
  typeof v === 'string' && (LEADERBOARD_GAMES as readonly string[]).includes(v)

/* -- names ----------------------------------------------------------------- */

export const NAME_MIN = 2
export const NAME_MAX = 14

/**
 * Deliberately narrow. A leaderboard is a shared space, and names that are
 * mostly invisible characters, or that differ from someone else's only by
 * something you cannot see, are the usual way that goes wrong.
 */
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length < NAME_MIN || name.length > NAME_MAX) return null
  if (!NAME_OK.test(name)) return null
  return name
}

/** Case- and spacing-insensitive, so `Dhruv` and `d h r u v` cannot coexist. */
export const nameKey = (name: string): string => name.toLowerCase().replace(/[\s_-]/g, '')

/* -- wire ------------------------------------------------------------------ */

export type Entry = { uid: string; name: string; score: number; at: number }

export type Champion = { uid: string; name: string; firsts: number }

export type Boards = {
  /** Highest first, capped. Missing key means nobody has posted a score. */
  games: Partial<Record<BoardGame, Entry[]>>
  /** Who holds first place in the most games. */
  champions: Champion[]
}

export type Me = { uid: string; name: string | null; admin: boolean }

/** A finished run, as the client reports it. */
export type Run = { game: string; score: number }

/**
 * How many queued runs one sync may carry.
 *
 * Generous for the case it exists for — a phone that was offline for a while —
 * and still small enough that a hostile client cannot make the server do an
 * unbounded amount of work in one request.
 */
export const MAX_SYNC = 24

export type ScoreReq =
  /** Public. Anyone in the app can read the boards without signing in. */
  | { op: 'boards' }
  | { op: 'signin'; key: string }
  /** One-time claim. Refused once a name is set, unless an admin does it. */
  | { op: 'name'; token: string; name: string; uid?: string }
  | { op: 'submit'; token: string; game: string; score: number }
  /** Runs banked while offline, drained in one write when the network returns. */
  | { op: 'sync'; token: string; runs: Run[] }

export type ScoreErrorCode =
  | 'BAD_REQUEST'
  | 'BAD_KEY'
  | 'BAD_TOKEN'
  | 'BAD_NAME'
  | 'NAME_TAKEN'
  | 'NAME_SET'
  | 'NOT_ADMIN'
  | 'CONFLICT'
  | 'DISABLED'

/**
 * Every success carries the boards, so the client never has to make a second
 * request to see the effect of what it just did.
 */
export type ScoreRes =
  | ({ ok: true } & Boards & {
      me?: Me
      /** Only on sign-in. The key itself is never stored or echoed. */
      token?: string
    })
  | { ok: false; error: ScoreErrorCode; message?: string }

/** One row per player per game; a run that beats it replaces it. */
export type ScoreDoc = {
  users: Record<string, { name: string; at: number }>
  best: Record<string, Record<string, { s: number; t: number }>>
}

export const emptyDoc = (): ScoreDoc => ({ users: {}, best: {} })

/** Guards against a fat-fingered or hostile number without judging skill. */
export const MAX_SCORE = 100_000

/** Rows kept per game. Long enough that nobody real falls off. */
export const BOARD_LIMIT = 50

/**
 * Ranked highest first, ties broken by who got there first — an earlier run
 * that matches a later one keeps the higher place, which is the convention
 * every arcade cabinet used and the one people expect.
 */
export function rank(doc: ScoreDoc, game: string): Entry[] {
  const rows = doc.best[game]
  if (!rows) return []
  return Object.entries(rows)
    .map(([uid, r]) => ({ uid, name: doc.users[uid]?.name ?? '—', score: r.s, at: r.t }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, BOARD_LIMIT)
}

export function boardsOf(doc: ScoreDoc): Boards {
  const games: Partial<Record<BoardGame, Entry[]>> = {}
  const firsts = new Map<string, number>()

  for (const game of LEADERBOARD_GAMES) {
    const rows = rank(doc, game)
    if (!rows.length) continue
    games[game] = rows
    // Only an outright first counts. A shared top score is broken by time, so
    // there is always exactly one holder and the totals always sum to the
    // number of contested games.
    firsts.set(rows[0].uid, (firsts.get(rows[0].uid) ?? 0) + 1)
  }

  const champions = [...firsts.entries()]
    .map(([uid, n]) => ({ uid, name: doc.users[uid]?.name ?? '—', firsts: n }))
    .sort((a, b) => b.firsts - a.firsts || a.name.localeCompare(b.name))

  return { games, champions }
}
