import { accountsEnabled, readSession } from './accounts.ts'

/**
 * The door and the account are the same thing.
 *
 * There used to be two secrets doing two jobs: a site key that let you in, and
 * a separate player key that said who you were. That meant the person at the
 * door was anonymous and the leaderboard was opt-in — you could play for an
 * hour and post nothing. One key now does both. You cannot reach a game without
 * being someone, so a score always has somewhere to go.
 *
 * The admin key is deliberately *not* a player. It exists to fix a name, and
 * giving it a place on the boards would mean the person who can rename everyone
 * also competes with them.
 *
 * The exchange itself — key for session — lives in `shared/scoreHandler.ts`,
 * because the name is part of who you are and the names live there. This file
 * is only what the hosts need to guard a request.
 */

/** Whether this deployment demands a sign-in at all. */
export const loginRequired = (): boolean => accountsEnabled()

/**
 * Guard for the room API.
 *
 * Open when nothing is configured — a checkout with no keys is a working app
 * for whoever is developing it, and there is nothing to protect because no key
 * opens anything either.
 *
 * `/api/scores` deliberately does *not* use this. It has to answer the sign-in
 * request that mints the token in the first place, so it authenticates one op
 * at a time inside the handler instead: boards are public, sign-in carries its
 * own key, and everything that writes demands a session.
 */
export function authorised(token: string | null | undefined): boolean {
  if (!accountsEnabled()) return true
  return readSession(token) !== null
}
