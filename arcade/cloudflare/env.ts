/**
 * Bindings, bridged onto `process.env`.
 *
 * `server/accounts.ts` reads the keys off `process.env` so that one
 * implementation serves Netlify, the local dev server and Workers alike.
 * Workers hand bindings to the request instead, and `nodejs_compat` gives us a
 * writable `process.env`, so this is the whole adapter.
 *
 * It lives in its own file because **every isolate needs its own bridge, and a
 * Durable Object is its own isolate.** Calling this in the Worker's fetch
 * handler does nothing for the objects it forwards to: they run elsewhere, with
 * an empty `process.env`, and every key lookup inside them comes back empty.
 *
 * That failure cannot be reproduced locally, which is how it reached
 * production. `wrangler dev --local` runs the Worker and its objects in one
 * process, so the Worker's own call to this leaks into every object's
 * `process.env` and the objects appear to work whether or not they bridge
 * anything. Verified by deleting the call below's use in `ScoresObject` and
 * watching sign-in keep succeeding. Deployed, the isolates are genuinely
 * separate and the leak is not there.
 */

export type ArcadeEnv = {
  ARCADE_KEY?: string
  ARCADE_PLAYER_KEYS?: string
}

export function bridgeEnv(env: ArcadeEnv): void {
  if (env.ARCADE_KEY !== undefined) process.env.ARCADE_KEY = env.ARCADE_KEY
  if (env.ARCADE_PLAYER_KEYS !== undefined) process.env.ARCADE_PLAYER_KEYS = env.ARCADE_PLAYER_KEYS
}
