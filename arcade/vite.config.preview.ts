import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * A single-file build, for sharing the app as one self-contained page.
 *
 * Not the deploy path — `vite.config.ts` is. This exists so the arcade can be
 * looked at somewhere that serves one HTML file and nothing else: no `/api`, no
 * service worker, no second request of any kind. What survives is everything
 * that runs entirely on the device — the solo games, the party games, the bots,
 * the themes. Rooms and the leaderboard need a server and are simply absent.
 *
 * Two settings do the work: dynamic imports are folded back in so the word list
 * is not a second request, and every asset is inlined so the fonts travel in
 * the CSS rather than beside it.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    outDir: 'dist-preview',
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
