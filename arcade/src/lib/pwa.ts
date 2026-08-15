import { useEffect, useState } from 'react'

/**
 * Service worker registration and the two facts the UI needs from it: whether
 * we are offline, and whether a newer build is sitting ready.
 *
 * The worker itself never takes over on its own. Swapping the code under a
 * running match is exactly the wrong moment, so a new build installs, waits, and
 * the app offers the player a reload.
 */

const SW_URL = '/sw.js'

/** Raised when a newer build is installed and waiting. */
export const UPDATE_EVENT = 'arcade:update-ready'

/** Set when *we* asked the waiting worker to take over, so the reload is ours. */
let claiming = false

export function registerServiceWorker(onUpdateReady: () => void): void {
  // Dev has no worker to register — see the note in `pwa/plugin.ts`.
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install also changes the controller, and reloading the page out
    // from under a first-time visitor for that would be baffling. Only a reload
    // we asked for counts.
    if (!claiming) return
    window.location.reload()
  })

  const register = () => {
    void navigator.serviceWorker
      .register(SW_URL)
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady()

        reg.addEventListener('updatefound', () => {
          const next = reg.installing
          if (!next) return
          next.addEventListener('statechange', () => {
            // `controller` is null on a first install. That is the app coming
            // under management, not an update, and there is nothing to offer.
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdateReady()
            }
          })
        })
      })
      .catch(() => {
        /* no offline support this session; the app still works online */
      })
  }

  // After load: registration competes with the app's own first paint otherwise,
  // and the precache fetches are the last thing that should have the network.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

/** Hand over to the waiting build. Resolves by reloading via controllerchange. */
export function applyUpdate(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    window.location.reload()
    return
  }
  claiming = true
  void navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg?.waiting) reg.waiting.postMessage('SKIP_WAITING')
    else window.location.reload()
  })
}

/**
 * Whether a newer build has installed and is waiting to take over.
 *
 * Subscribes to the event `registerServiceWorker` raises, so any component can
 * ask without the flag being threaded down from the root. Latched on: once a
 * build is waiting it stays waiting until the page reloads.
 */
export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const on = () => setReady(true)
    window.addEventListener(UPDATE_EVENT, on)
    return () => window.removeEventListener(UPDATE_EVENT, on)
  }, [])

  return ready
}

/**
 * Whether the browser thinks it has a network.
 *
 * Deliberately treated as a hint, not a verdict: `navigator.onLine` is true on
 * a wifi network with no route to the internet, which is a very common way to
 * be offline. It is used to explain and to soften what is already failing —
 * never to decide whether a request is worth making, because the request
 * failing is the more reliable signal and the transport already handles it.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  )

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
