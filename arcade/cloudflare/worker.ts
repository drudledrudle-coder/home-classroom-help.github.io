import { authorised, loginRequired } from '../server/login.ts'
import { bridgeEnv } from './env.ts'
import type { ArcadeEnv } from './env.ts'

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

export type Env = ArcadeEnv & {
  ASSETS: Fetcher
  ROOMS: DurableObjectNamespace
  SCORES: DurableObjectNamespace
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
