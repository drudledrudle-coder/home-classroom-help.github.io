import {
  WRONG_KEY_DELAY_MS,
  issueToken,
  pause,
  safeEqual,
  siteKey,
  verifyToken,
} from '../server/gateToken.ts'

export { RoomsObject } from './RoomsObject.ts'
export { ScoresObject } from './ScoresObject.ts'

/**
 * The Cloudflare entry point.
 *
 * Three API routes and the static site. Everything below `/api` is the same
 * pure handler the Netlify functions and the local dev server run — only the
 * storage and the hosting differ, which is what made the move a matter of
 * writing two Durable Objects rather than rewriting a server.
 *
 * The Netlify functions are deliberately still in the repository. They are a
 * working deployment of the same app on another host, they cost nothing to
 * keep, and having them means this migration is reversible rather than a
 * one-way door.
 */

export type Env = {
  ASSETS: Fetcher
  ROOMS: DurableObjectNamespace
  SCORES: DurableObjectNamespace
  ARCADE_KEY?: string
  ARCADE_PLAYER_KEYS?: string
}

/**
 * Workers hand bindings to the request rather than putting them on the process,
 * but `server/gateToken.ts` and `server/accounts.ts` read `process.env` so that
 * one implementation serves Netlify, the dev server and this. `nodejs_compat`
 * gives us a writable `process.env`, so the bridge is three lines and the
 * security-carrying code stays identical across all three.
 */
function bridgeEnv(env: Env): void {
  if (env.ARCADE_KEY !== undefined) process.env.ARCADE_KEY = env.ARCADE_KEY
  if (env.ARCADE_PLAYER_KEYS !== undefined) process.env.ARCADE_PLAYER_KEYS = env.ARCADE_PLAYER_KEYS
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    bridgeEnv(env)
    const url = new URL(request.url)

    if (url.pathname === '/api/gate') return gate(request)

    if (url.pathname === '/api/room' || url.pathname === '/api/scores') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'POST only' }, 405)
      }

      // The key guards the API, not just the entry screen — otherwise it is
      // decoration, since rooms and boards could be driven directly.
      const key = siteKey()
      if (key && !verifyToken(request.headers.get('x-arcade-token'), key)) {
        return json({ ok: false, error: 'LOCKED' }, 401)
      }

      const [namespace, name] =
        url.pathname === '/api/room' ? [env.ROOMS, 'rooms'] : [env.SCORES, 'board']

      const stub = namespace.get(namespace.idFromName(name))
      return stub.fetch(request)
    }

    // Everything else is the built site. `not_found_handling` in wrangler.toml
    // serves index.html for unknown paths, which is the SPA fallback the
    // Netlify redirect used to provide.
    return env.ASSETS.fetch(request)
  },
}

/**
 * Unlock endpoint for the site key.
 *
 *   GET  /api/gate  -> { required }     does this site have a key at all
 *   POST /api/gate  -> { ok, token }    exchange the key for an unlock token
 */
async function gate(request: Request): Promise<Response> {
  const key = siteKey()

  if (request.method === 'GET') return json({ required: !!key }, 200)
  if (request.method !== 'POST') return json({ ok: false, error: 'BAD_REQUEST' }, 405)
  if (!key) return json({ ok: true, required: false, token: null }, 200)

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
