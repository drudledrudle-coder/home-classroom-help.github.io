/**
 * Offline support. Template — `pwa/plugin.ts` fills in the two placeholders at
 * build time and emits the result as `dist/sw.js`.
 *
 * The rule that matters most is the one about `/api/`. Everything the app needs
 * to *run* is a hashed, immutable file and can be cached for ever; everything
 * the app needs to *play against someone* is live state that must never come
 * from a cache. Getting that boundary wrong would mean a room resuming from a
 * stale log, or — much worse — the key check answering "unlocked" out of cache.
 */

const VERSION = '__VERSION__'
const CACHE = `arcade-${VERSION}`
const SHELL = '/index.html'

/**
 * Everything needed to open the app cold with no network.
 *
 * Lazily imported chunks are deliberately absent: Word Sprint's dictionary is
 * most of the payload and most sessions never open it, so it is fetched on
 * demand and kept from then on. The cost is that Word Sprint needs one online
 * play before it works offline; everything else works immediately.
 */
const PRECACHE = __PRECACHE__

/**
 * `ignoreVary` is load bearing, and its absence is a silent, total failure.
 *
 * Hosts commonly answer static assets with `Vary: Origin` — Netlify does, and so
 * does `vite preview`. The precache fetches these from the worker, which sends
 * no `Origin` header; the page then asks for the same file as a module script,
 * which is a CORS-mode request and *does* send one. Under `Vary` those are
 * different representations, so every single lookup misses, and the app that
 * looked perfectly precached serves nothing at all the moment it goes offline.
 *
 * Ignoring it is safe here because we store exactly one representation per URL,
 * the URLs are content-hashed and immutable, and the Cache API stores bodies
 * already decoded — so there is no encoding negotiation left to get wrong.
 */
const MATCH = { ignoreVary: true }

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Individually rather than addAll: one 404 in the list would otherwise
      // reject the whole install and leave the app with no offline support at
      // all, which is a much worse failure than one missing icon.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      ),
    ),
  )
  // No skipWaiting here on purpose. A new worker taking over mid-match would
  // swap the code under a running game; the page asks the player instead.
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k.startsWith('arcade-') && k !== CACHE).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Live state, never cached. A stale room is worse than an error, and a cached
  // gate response would hand out access the server never granted.
  if (url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(shell(req))
    return
  }
  event.respondWith(asset(req))
})

/**
 * The app shell, served from cache first so a cold launch is instant and works
 * with no network, then refreshed in the background.
 *
 * Cache-first is only safe here because there is a real update path: the
 * browser re-checks `sw.js` on navigation, a new build installs as a waiting
 * worker, and the page offers the player a reload. Without that this would
 * pin everyone to the first version they ever loaded.
 */
async function shell(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(SHELL, MATCH)

  const fresh = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(SHELL, res.clone())
      return res
    })
    .catch(() => null)

  if (hit) return hit
  const res = await fresh
  return res ?? new Response('Offline', { status: 503, statusText: 'Offline' })
}

/** Hashed and immutable, so a hit is always correct and always preferred. */
async function asset(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req, MATCH)
  if (hit) return hit

  try {
    const res = await fetch(req)
    // Only real same-origin successes. Caching an error or an opaque response
    // would serve it for the life of this version.
    if (res.ok && res.type === 'basic') cache.put(req, res.clone())
    return res
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' })
  }
}
