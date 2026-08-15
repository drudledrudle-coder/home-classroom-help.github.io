/**
 * Fold the single-file build into one page.
 *
 * Vite emits one JS and one CSS file (the fonts already inlined into the CSS as
 * data URIs by `assetsInlineLimit`). This puts both inside the HTML and drops
 * the links that would otherwise be a second request — the icon, the manifest,
 * the favicon — so the result loads with no network at all.
 *
 * Output is a fragment rather than a document: `<html>`, `<head>` and `<body>`
 * are supplied by the host it is published to.
 *
 *   node scripts/inline-preview.mjs <build-dir> <output.html>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir = 'dist-preview', out = 'dist-preview/arcade-preview.html'] = process.argv.slice(2)

const html = readFileSync(join(dir, 'index.html'), 'utf8')

const cssHref = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)?.[1]
const jsSrc = html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1]
if (!cssHref || !jsSrc) throw new Error('could not find the built css/js in index.html')

const read = (href) => readFileSync(join(dir, href.replace(/^\//, '')), 'utf8')

// A script tag ends at the first `</script` in the *text*, whatever it means to
// the JavaScript around it. Any such sequence inside a string literal would cut
// the bundle in half, so it is escaped — `<\/` is identical to `</` to a JS
// parser and invisible to the HTML one.
const safe = (js) => js.replace(/<\/script/gi, '<\\/script')

// The pre-paint theme script from index.html is worth keeping: it is what stops
// the page flashing the wrong mode before React mounts.
const prePaint = html.match(/<script>\s*\n([\s\S]*?)<\/script>/)?.[1] ?? ''

// No colour fallback is added here on purpose. The app already declares its
// palette on `:root, [data-theme='light']`, so a bare root resolves to the full
// light theme and `[data-theme]` overrides it — which means the page paints its
// own ground even if the host owns the attribute or clears it. Verified against
// a host stamping dark, light, nothing, and a value the app does not know.
const page = `<title>Arcade</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
<meta name="color-scheme" content="dark light" />

<style>
${read(cssHref)}
</style>

<script>
${prePaint}
</script>

<div id="root"></div>

<script type="module">
${safe(read(jsSrc))}
</script>
`

writeFileSync(out, page)
console.log(`${out} — ${(Buffer.byteLength(page) / 1024 / 1024).toFixed(2)} MB`)
