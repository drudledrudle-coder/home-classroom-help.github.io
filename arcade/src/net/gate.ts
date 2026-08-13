/**
 * Client half of the site key. Holds only the unlock token the server issued —
 * never the key itself, which is never sent to the browser in the first place.
 */

const ENDPOINT = '/api/gate'
const TOKEN_KEY = 'arcade.gate'

export type UnlockResult = 'ok' | 'wrong' | 'offline'

function read(name: string): string | null {
  try {
    return sessionStorage.getItem(name)
  } catch {
    return null
  }
}

function write(name: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(name)
    else sessionStorage.setItem(name, value)
  } catch {
    /* storage disabled; the token just will not survive a refresh */
  }
}

export const gateToken = (): string | null => read(TOKEN_KEY)
export const clearGateToken = (): void => write(TOKEN_KEY, null)

/**
 * Does this deployment have a key at all? Answers without revealing anything
 * about it, so the client knows whether to render the key screen.
 */
export async function gateRequired(): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, { method: 'GET' })
    if (!res.ok) return false
    const body = (await res.json()) as { required?: boolean }
    return !!body.required
  } catch {
    // Can't reach the endpoint: let the app open rather than locking someone
    // out of solo play over a flaky network. Room requests still fail closed
    // server-side, so this cannot be used to bypass the key.
    return false
  }
}

export async function unlock(key: string): Promise<UnlockResult> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    const body = (await res.json()) as { ok?: boolean; token?: string | null }
    if (!res.ok || !body.ok) return 'wrong'
    if (body.token) write(TOKEN_KEY, body.token)
    return 'ok'
  } catch {
    return 'offline'
  }
}

/** Header attached to every room request while a token is held. */
export function gateHeaders(): Record<string, string> {
  const token = gateToken()
  return token ? { 'x-arcade-token': token } : {}
}
