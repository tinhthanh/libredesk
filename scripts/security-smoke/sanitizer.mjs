// Proof, in a real Chromium, that message HTML can't run script through <Letter>:
// lettersanitizer alone (what vue-letter uses) lets the confirmed <style> breakout run, and
// safeHtml in front of it (shared-ui/utils/safeHtml.js) stops it, for every payload.
//   node scripts/security-smoke/sanitizer.mjs     (exit 1 when a payload runs after safeHtml)
import fs from 'node:fs'
import path from 'node:path'
import { chromium, frontend } from './playwright.mjs'

const letter = path.join(frontend, 'node_modules/lettersanitizer/lib/esm')
const shared = path.join(frontend, 'shared-ui/utils')

const PAYLOADS = {
  breakout: '<style>p{font-family:"\\3C/style\\3E\\3Cimg src=x onerror=window.__ran=1\\3E"}</style><p>hi</p>',
  'breakout in head': '<html><head><style>p{font-family:"\\3C/style\\3E\\3Cimg src=x onerror=window.__ran=1\\3E"}</style></head><body><p>hi</p></body></html>',
  'uppercase breakout': '<STYLE>p{font-family:"\\3C/style\\3E\\3Cimg src=x onerror=window.__ran=1\\3E"}</STYLE><p>hi</p>',
  'svg style': '<svg><style>p{font-family:"\\3C/style\\3E\\3Cimg src=x onerror=window.__ran=1\\3E"}</style></svg><p>hi</p>',
  'math confusion': '<math><mtext><table><mglyph><style><img src=x onerror=window.__ran=1>',
  'plain onerror': '<img src=x onerror=window.__ran=1>',
  script: '<script>window.__ran=1</script>'
}

const b = await (await chromium()).launch()
const page = await b.newPage()
await page.route('http://t.local/**', (r) => {
  const p = new URL(r.request().url()).pathname
  if (p === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><div id=out></div>' })
  const f = p.startsWith('/shared/') ? path.join(shared, p.slice(8)) : path.join(letter, p)
  if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' })
  return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(f) })
})
await page.goto('http://t.local/')

let failed = false
for (const [name, html] of Object.entries(PAYLOADS)) {
  const ran = await page.evaluate(async (html) => {
    const { sanitize } = await import('/index.js')
    const { safeHtml } = await import('/shared/safeHtml.js')
    const run = async (h) => {
      window.__ran = 0
      const out = document.getElementById('out')
      out.innerHTML = sanitize(h, '', {})
      await new Promise((r) => setTimeout(r, 300))
      out.innerHTML = ''
      return window.__ran === 1
    }
    return { alone: await run(html), withSafeHtml: await run(safeHtml(html)) }
  }, html)
  const ok = !ran.withSafeHtml
  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: lettersanitizer alone ran=${ran.alone}, with safeHtml ran=${ran.withSafeHtml}`)
}
await b.close()
process.exit(failed ? 1 : 0)
