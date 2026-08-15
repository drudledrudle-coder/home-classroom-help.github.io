import {
  MAX_SCORE,
  MAX_SYNC,
  boardsOf,
  cleanName,
  emptyDoc,
  isBoardGame,
  nameKey,
} from './scores.ts'
import type { BoardGame, ScoreDoc, ScoreErrorCode, ScoreReq, ScoreRes, Run } from './scores.ts'

/**
 * The whole leaderboard server, with no runtime in it.
 *
 * Same shape as `roomHandler`: a pure function over a small store interface, so
 * the deployed function and the local dev stand-in run identical logic and only
 * the storage differs.
 */

export type Stored = { doc: ScoreDoc; version?: string }

export interface ScoreStore {
  read(): Promise<Stored | null>
  /** Compare-and-swap. False means someone else wrote first; caller retries. */
  write(doc: ScoreDoc, prev: Stored | null): Promise<boolean>
}

export type Accounts = {
  /** Resolves a sign-in key to an account, or null if it is not one. */
  identify(key: unknown): { uid: string; admin: boolean } | null
  issue(uid: string, admin: boolean): string
  read(token: unknown): { uid: string; admin: boolean } | null
  /** False when no keys are configured at all, so the UI can say so. */
  enabled(): boolean
}

const fail = (error: ScoreErrorCode, message?: string): ScoreRes => ({ ok: false, error, message })

/** Contention here is two people finishing a run in the same instant. */
const RETRIES = 4

/**
 * Fixed pause on a wrong key.
 *
 * This is the login now, so it is the one endpoint worth guessing at. There is
 * no datastore to count attempts per address against, so a flat delay is the
 * floor on guess rate — it caps a single attacker at a couple of tries a
 * second, which is enough against a key nobody is going to brute-force by hand.
 */
const WRONG_KEY_DELAY_MS = 450

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function handleScoreRequest(
  store: ScoreStore,
  accounts: Accounts,
  req: ScoreReq,
  now: number = Date.now(),
): Promise<ScoreRes> {
  if (!req || typeof req !== 'object') return fail('BAD_REQUEST')

  if (req.op === 'boards') {
    const stored = await store.read()
    return { ok: true, ...boardsOf(stored?.doc ?? emptyDoc()) }
  }

  if (req.op === 'signin') {
    if (!accounts.enabled()) return fail('DISABLED', 'No sign-in keys are configured')
    const who = accounts.identify(req.key)
    if (!who) {
      await pause(WRONG_KEY_DELAY_MS)
      return fail('BAD_KEY')
    }

    const stored = await store.read()
    const doc = stored?.doc ?? emptyDoc()
    return {
      ok: true,
      ...boardsOf(doc),
      me: { uid: who.uid, name: doc.users[who.uid]?.name ?? null, admin: who.admin },
      // The token is the thing the client keeps. The key is never stored, never
      // echoed, and cannot be recovered from the id derived from it.
      token: accounts.issue(who.uid, who.admin),
    }
  }

  const session = accounts.read((req as { token?: unknown }).token)
  if (!session) return fail('BAD_TOKEN')

  if (req.op === 'name') {
    const name = cleanName(req.name)
    if (!name) return fail('BAD_NAME')

    // Admins may name anyone; everyone else may only ever name themselves, and
    // only once. That "once" is the whole point of the rule, so it is enforced
    // here rather than by hiding the control.
    const target = req.uid && session.admin ? req.uid : session.uid
    if (req.uid && req.uid !== session.uid && !session.admin) return fail('NOT_ADMIN')

    return commit(store, (doc) => {
      const existing = doc.users[target]
      if (existing && !session.admin) return fail('NAME_SET')

      const wanted = nameKey(name)
      for (const [uid, u] of Object.entries(doc.users)) {
        if (uid !== target && nameKey(u.name) === wanted) return fail('NAME_TAKEN')
      }

      doc.users[target] = { name, at: existing?.at ?? now }
      return null
    }, session)
  }

  if (req.op === 'submit' || req.op === 'sync') {
    const runs: Run[] = req.op === 'submit' ? [{ game: req.game, score: req.score }] : req.runs
    if (!Array.isArray(runs)) return fail('BAD_REQUEST', 'runs must be a list')
    if (runs.length > MAX_SYNC) return fail('BAD_REQUEST', 'too many runs')

    // A submit names one run and is told when that run is nonsense. A sync is a
    // queue drained off a phone that may have been offline across a deploy, so
    // an entry it can no longer place is dropped rather than wedging the whole
    // queue behind it forever.
    const strict = req.op === 'submit'
    const clean: Array<{ game: BoardGame; score: number }> = []

    for (const run of runs) {
      if (!isBoardGame(run.game)) {
        if (strict) return fail('BAD_REQUEST', 'unknown game')
        continue
      }
      const score = Math.floor(Number(run.score))
      if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
        if (strict) return fail('BAD_REQUEST', 'implausible score')
        continue
      }
      clean.push({ game: run.game, score })
    }

    return commit(store, (doc) => {
      // Posting before claiming a name would put an anonymous row on a public
      // board, so the name is the price of entry.
      if (!doc.users[session.uid]) return fail('BAD_NAME', 'claim a name first')

      for (const { game, score } of clean) {
        const board = (doc.best[game] ??= {})
        const prev = board[session.uid]
        // Only an improvement is written. A worse run is not an error — it is
        // most runs — so this succeeds and simply changes nothing.
        //
        // Stamped with arrival time even for a run played hours ago offline.
        // That time only breaks ties on the board, and taking it from the
        // client would let anyone claim an ancient one to win every tie.
        if (!prev || score > prev.s) board[session.uid] = { s: score, t: now }
      }
      return null
    }, session)
  }

  return fail('BAD_REQUEST', 'unknown op')
}


/**
 * Read, mutate, write, retry on a lost race.
 *
 * `mutate` returns an error to abort, or null to accept its edits. It is given
 * a fresh copy on every attempt, so a rejected write cannot leave half of a
 * change behind.
 */
async function commit(
  store: ScoreStore,
  mutate: (doc: ScoreDoc) => ScoreRes | null,
  session: { uid: string; admin: boolean },
): Promise<ScoreRes> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const stored = await store.read()
    const doc: ScoreDoc = stored?.doc
      ? (JSON.parse(JSON.stringify(stored.doc)) as ScoreDoc)
      : emptyDoc()

    const refused = mutate(doc)
    if (refused) return refused

    if (await store.write(doc, stored)) {
      return {
        ok: true,
        ...boardsOf(doc),
        me: { uid: session.uid, name: doc.users[session.uid]?.name ?? null, admin: session.admin },
      }
    }
  }
  return fail('CONFLICT')
}
