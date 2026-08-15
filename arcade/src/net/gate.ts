/**
 * One question, asked before anyone has signed in: does this deployment have
 * accounts at all?
 *
 * That is all that is left here. The key itself is exchanged for a session by
 * `account.ts`, which owns the token from then on.
 */

const ENDPOINT = '/api/gate'
const CACHE_KEY = 'arcade.login.required'

/**
 * The answer is remembered because the app is expected to run offline.
 *
 * Without a cache, an offline launch cannot tell "this arcade has no accounts"
 * from "cannot reach the server", and it has to guess. Guessing open would let
 * anyone play by pulling the plug; guessing closed would strand a signed-in
 * player on a train. Having asked once, offline launches know the real answer
 * and neither guess is needed.
 *
 * A first-ever visit with no network is not a case worth handling: the service
 * worker has to install from a live page too, so there is no app to open yet.
 */
function cached(): boolean | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw === null ? null : raw === '1'
  } catch {
    return null
  }
}

export async function loginRequired(): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, { method: 'GET' })
    if (!res.ok) throw new Error(String(res.status))
    const required = !!((await res.json()) as { required?: boolean }).required
    try {
      localStorage.setItem(CACHE_KEY, required ? '1' : '0')
    } catch {
      /* storage disabled; we will just ask again next launch */
    }
    return required
  } catch {
    return cached() ?? false
  }
}
