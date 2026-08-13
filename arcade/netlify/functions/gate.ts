/**
 * Unlock endpoint for the site key.
 *
 *   GET  /api/gate  -> { required }        does this site have a key at all
 *   POST /api/gate  -> { ok, token }       exchange the key for an unlock token
 */

import {
  WRONG_KEY_DELAY_MS,
  issueToken,
  pause,
  safeEqual,
  siteKey,
} from '../../server/gateToken.ts'

export default async function handler(request: Request): Promise<Response> {
  const key = siteKey()

  // Lets the client decide whether to show the key screen without leaking
  // anything about the key itself.
  if (request.method === 'GET') {
    return json({ required: !!key }, 200)
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'BAD_REQUEST' }, 405)
  }

  if (!key) {
    return json({ ok: true, required: false, token: null }, 200)
  }

  let submitted: unknown
  try {
    submitted = ((await request.json()) as { key?: unknown }).key
  } catch {
    return json({ ok: false, error: 'BAD_REQUEST' }, 400)
  }

  if (typeof submitted !== 'string' || !safeEqual(submitted.trim(), key)) {
    await pause(WRONG_KEY_DELAY_MS)
    return json({ ok: false, error: 'BAD_KEY' }, 401)
  }

  return json({ ok: true, required: true, token: issueToken(key) }, 200)
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
