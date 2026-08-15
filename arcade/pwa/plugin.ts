import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

/**
 * Emits `dist/sw.js` from `pwa/sw.js`, with the precache list and a version
 * stamp filled in from the actual build output.
 *
 * Generating the list rather than hand-writing it is the whole point: Vite
 * content-hashes every asset filename, so a hand-maintained list would go stale
 * on the next build and the app would precache files that no longer exist.
 *
 * Build only. A service worker in `vite dev` would serve yesterday's modules
 * over today's edits, which is a genuinely miserable way to lose an afternoon.
 */
export function pwaServiceWorker(): Plugin {
  return {
    name: 'arcade-sw',
    apply: 'build',

    generateBundle(_options, bundle) {
      // Static files from `public/`, which never appear in the bundle graph.
      const precache = new Set<string>([
        // `/`, not `/index.html` — see the note on SHELL in sw.js. One host
        // redirects the latter, and a redirect cannot be cached.
        '/',
        '/site.webmanifest',
        '/favicon.svg',
        '/icon-192.png',
        '/icon-512.png',
        '/apple-touch-icon.png',
      ])

      let htmlSource = ''

      for (const [file, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          // Dynamic entries are fetched on demand and cached then. The word
          // list alone is most of the payload and most sessions never open Word
          // Sprint, so precaching it would multiply the install cost of the
          // whole app for one game.
          if (output.isDynamicEntry) continue
          precache.add('/' + file)
          continue
        }
        if (file === 'index.html') htmlSource = String(output.source)
        // Styles and fonts are both needed for the first paint; other assets
        // (icons) are already listed above.
        if (/\.(css|woff2?)$/.test(file)) precache.add('/' + file)
      }

      const list = [...precache].sort()
      // Asset names are content-hashed, so the list changes whenever any of them
      // does. `index.html` is not hashed, so its contents go in explicitly —
      // otherwise a title or meta change would ship with a stale cache name and
      // never reach anyone.
      const version = createHash('sha256')
        .update(list.join('\n'))
        .update(htmlSource)
        .digest('hex')
        .slice(0, 12)

      const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__VERSION__', version)
          .replace('__PRECACHE__', JSON.stringify(list, null, 2)),
      })
    },
  }
}
