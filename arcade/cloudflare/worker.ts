import { authorised, loginRequired } from '../server/login.ts'

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
 * but `server/accounts.ts` reads `process.env` so that one implementation
 * serves Netlify, the dev server and this. `nodejs_compat`
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

    // Answers before anyone has signed in, so it gives away nothing about the
    // key beyond whether one exists.
    if (url.pathname === '/api/gate') {
      if (request.method !== 'GET') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'GET only' }, 405)
      }
      return json({ required: loginRequired() }, 200)
    }

    if (url.pathname === '/api/room' || url.pathname === '/api/scores') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'BAD_REQUEST', message: 'POST only' }, 405)
      }

      // Being signed in guards the room API, not just the entry screen —
      // otherwise it is decoration, since rooms could be driven directly.
      //
      // `/api/scores` is exempt because it is where a token comes from: it
      // authenticates one op at a time inside the handler instead.
      if (url.pathname === '/api/room' && !authorised(request.headers.get('x-arcade-token'))) {
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

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
