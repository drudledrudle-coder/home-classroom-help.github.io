/**
 * The room sequencer, backed by Netlify Blobs.
 *
 * Two details matter here:
 *  - `consistency: 'strong'`. Blobs reads are eventually consistent by default,
 *    which would let a player read back a log that is missing their opponent's
 *    last move.
 *  - `onlyIfMatch` / `onlyIfNew`. Compare-and-swap on the etag is what makes the
 *    retry loop in roomHandler correct when both players write in the same tick.
 */

import { getStore } from '@netlify/blobs'
import { siteKey, verifyToken } from '../../server/gateToken.ts'
import type { RoomReq } from '../../shared/protocol.ts'
import { DEFAULT_HOLD, handleRoomRequest } from '../../shared/roomHandler.ts'
import type { RoomDoc, RoomStore, Stored } from '../../shared/roomHandler.ts'

const STORE_NAME = 'arcade-rooms'

function blobStore(): RoomStore {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })

  return {
    async read(code: string): Promise<Stored | null> {
      const hit = await store.getWithMetadata(code, { type: 'json', consistency: 'strong' })
      if (!hit || !hit.data) return null
      return { doc: hit.data as RoomDoc, version: hit.etag }
    },

    async write(code: string, doc: RoomDoc, prev: Stored | null): Promise<boolean> {
      // No previous read means we expect to be creating the key outright.
      const options = prev?.version ? { onlyIfMatch: prev.version } : { onlyIfNew: true }
      const result = await store.setJSON(code, doc, options)
      return result.modified
    },

    async remove(code: string): Promise<void> {
      await store.delete(code)
    },
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'BAD_REQUEST', message: 'POST only' }, 405)
  }

  // The key has to guard the API too, not just the entry screen — otherwise it
  // is decoration, since rooms could still be driven directly.
  const key = siteKey()
  if (key && !verifyToken(request.headers.get('x-arcade-token'), key)) {
    return json({ ok: false, error: 'LOCKED' }, 401)
  }

  let body: RoomReq
  try {
    body = (await request.json()) as RoomReq
  } catch {
    return json({ ok: false, error: 'BAD_REQUEST', message: 'invalid JSON' }, 400)
  }

  try {
    const res = await handleRoomRequest(blobStore(), body, Date.now(), DEFAULT_HOLD)
    return json(res, res.ok ? 200 : statusFor(res.error))
  } catch (error) {
    console.error('room handler failed', error)
    return json({ ok: false, error: 'SERVER' }, 500)
  }
}

function statusFor(code: string): number {
  switch (code) {
    case 'NO_ROOM':
    case 'NOT_A_MEMBER':
      return 404
    case 'ROOM_FULL':
      return 409
    case 'CONFLICT':
      return 503
    case 'LOCKED':
      return 401
    case 'TOO_BIG':
      return 413
    case 'BAD_REQUEST':
      return 400
    default:
      return 500
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}
