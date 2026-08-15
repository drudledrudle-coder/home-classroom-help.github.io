/**
 * Leaderboards, backed by Netlify Blobs.
 *
 * One document rather than a key per player: the whole board is read on every
 * request anyway, and a single compare-and-swap is what makes two people
 * finishing a run in the same instant safe. It is a handful of kilobytes for a
 * group of friends, which is the size this is for.
 */

import { getStore } from '@netlify/blobs'
import { identify, issueSession, playerKeys, readSession } from '../../server/accounts.ts'
import { adminKey } from '../../server/accounts.ts'
import { siteKey, verifyToken } from '../../server/gateToken.ts'
import { handleScoreRequest } from '../../shared/scoreHandler.ts'
import type { Accounts, ScoreStore, Stored } from '../../shared/scoreHandler.ts'
import type { ScoreDoc, ScoreReq } from '../../shared/scores.ts'

const STORE_NAME = 'arcade-scores'
const DOC_KEY = 'board'

function blobStore(): ScoreStore {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })

  return {
    async read(): Promise<Stored | null> {
      const hit = await store.getWithMetadata(DOC_KEY, { type: 'json', consistency: 'strong' })
      if (!hit || !hit.data) return null
      return { doc: hit.data as ScoreDoc, version: hit.etag }
    },

    async write(doc: ScoreDoc, prev: Stored | null): Promise<boolean> {
      const options = prev?.version ? { onlyIfMatch: prev.version } : { onlyIfNew: true }
      const result = await store.setJSON(DOC_KEY, doc, options)
      return result.modified
    },
  }
}

const accounts: Accounts = {
  identify,
  issue: issueSession,
  read: readSession,
  enabled: () => playerKeys().length > 0 || adminKey() !== null,
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'BAD_REQUEST', message: 'POST only' }, 405)
  }

  // The site key guards this the same way it guards rooms: the boards are only
  // for people already through the door.
  const key = siteKey()
  if (key && !verifyToken(request.headers.get('x-arcade-token'), key)) {
    return json({ ok: false, error: 'LOCKED' }, 401)
  }

  let body: ScoreReq
  try {
    body = (await request.json()) as ScoreReq
  } catch {
    return json({ ok: false, error: 'BAD_REQUEST', message: 'invalid JSON' }, 400)
  }

  try {
    const res = await handleScoreRequest(blobStore(), accounts, body)
    return json(res, res.ok ? 200 : 400)
  } catch {
    return json({ ok: false, error: 'CONFLICT', message: 'store unavailable' }, 503)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
