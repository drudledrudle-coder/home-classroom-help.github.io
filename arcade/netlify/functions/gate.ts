/**
 * Does this deployment require a login?
 *
 *   GET /api/gate -> { required }
 *
 * That is the whole endpoint. It used to also exchange the site key for an
 * unlock token, but the key and the account are one thing now, so the exchange
 * happens at `/api/scores` with `op: 'signin'` — the only place that knows the
 * player's name, which is half of what a login has to return.
 *
 * This answers before anyone has signed in, so it must give away nothing about
 * the key beyond whether one exists.
 */

import { loginRequired } from '../../server/login.ts'

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ ok: false, error: 'BAD_REQUEST', message: 'GET only' }, 405)
  }
  return json({ required: loginRequired() }, 200)
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
