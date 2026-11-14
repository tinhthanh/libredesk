// Proof on a running Libredesk (built from this repo) that customer-controlled content can't
// run script in the agent app, that what templates add is escaped, and that the app runs
// under its Content-Security-Policy with no violation. Uses only the HTTP API and a headless
// Chromium; it creates an inbox, an agent, a contact and notes, so run it against a
// throwaway instance, never a clinic's.
//
//   LD_URL=http://localhost:9311 LD_SYSTEM_PASSWORD=... node scripts/security-smoke/app.mjs
//
// Checks (exit 1 on the first failure):
//   1. a note with the <style> breakout renders and runs nothing;
//   2. a note an agent writes with {{ "<style>..." }} and {{ .Contact.FirstName }} (a contact
//      named <img onerror>) is stored escaped and shown as text;
//   3. a note the System user sends (the gateway's) is stored as it is, braces and all;
//   4. login, inbox, the conversation (with an image attachment) and settings load with no
//      CSP violation and no page error, and the image shows.
import crypto from 'node:crypto'
import { chromium } from './playwright.mjs'

const base = process.env.LD_URL || 'http://localhost:9311'
const systemPassword = process.env.LD_SYSTEM_PASSWORD
if (!systemPassword) {
  console.error('set LD_SYSTEM_PASSWORD (the throwaway instance\'s System password)')
  process.exit(2)
}
const run = crypto.randomBytes(3).toString('hex')
const BREAKOUT = '<style>p{font-family:"\\3C/style\\3E\\3Cimg src=x onerror=window.__ran=1\\3E"}</style><p>breakout-' + run + '</p>'
const TEMPLATE = '<p>tmpl-' + run + ' {{ "<style>p{}</style><img src=x onerror=window.__ran=1>" }} name={{ .Contact.FirstName }}</p>'
const SYSTEM_NOTE = '<p>system-' + run + ' {{ .Contact.FirstName }}</p>'
const EVIL_NAME = '<img src=x onerror=window.__ran=1>'
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const ok = (what) => console.log(`ok   ${what}`)
const fail = (what) => {
  throw new Error(what)
}

const browser = await (await chromium()).launch()
let failed = false
try {
  // A session for the API calls (System, then the agent), sharing cookies with its pages.
  const session = async (email, password) => {
    const ctx = await browser.newContext({ baseURL: base })
    await ctx.request.get('/') // sets the CSRF cookie
    const res = await ctx.request.post('/api/v1/auth/login', { data: { email, password } })
    if (!res.ok()) fail(`login ${email}: HTTP ${res.status()}`)
    const csrf = (await ctx.cookies()).find((c) => c.name === 'csrf_token')?.value || ''
    const call = async (method, path, data, extra = {}) => {
      const r = await ctx.request.fetch(path, { method, data, headers: { 'X-CSRFTOKEN': csrf }, ...extra })
      const body = await r.json().catch(() => ({}))
      if (!r.ok()) fail(`${method} ${path}: HTTP ${r.status()} ${JSON.stringify(body).slice(0, 200)}`)
      return body.data
    }
    return { ctx, call }
  }

  const sys = await session('System', systemPassword)
  const inbox = await sys.call('POST', '/api/v1/inboxes', {
    name: `security-smoke-${run}`, channel: 'livechat', enabled: true, secret: crypto.randomBytes(16).toString('hex'),
    config: {
      features: { file_upload: true }, colors: { primary: '#0068ff' }, launcher: { position: 'right', spacing: { side: 20, bottom: 20 } },
      users: { allow_start_conversation: true, prevent_multiple_conversations: true }, visitors: { allow_start_conversation: false }
    }
  })
  const agentEmail = `sec.agent.${run}@acme.test`
  const agentPassword = `Agent-${crypto.randomBytes(6).toString('hex')}-A1!`
  const agent = await sys.call('POST', '/api/v1/agents', { first_name: 'Sec', last_name: 'Agent', email: agentEmail, roles: ['Admin'], enabled: true, send_welcome_email: false })
  await sys.call('PUT', `/api/v1/agents/${agent.id}`, { first_name: 'Sec', last_name: 'Agent', email: agentEmail, roles: ['Admin'], enabled: true, new_password: agentPassword })
  const conv = await sys.call('POST', '/api/v1/conversations', {
    inbox_id: inbox.id, contact_email: `customer.${run}@acme.test`, first_name: EVIL_NAME, last_name: 'Khach',
    subject: `security smoke ${run}`, content: 'hello', initiator: 'contact'
  })
  await sys.call('POST', `/api/v1/conversations/${conv.uuid}/messages`, { message: SYSTEM_NOTE, private: true, sender_type: 'agent' })
  ok(`set up inbox, agent, conversation ${conv.uuid} with a contact named <img onerror>`)

  const ag = await session(agentEmail, agentPassword)
  const media = await ag.call('POST', '/api/v1/media', undefined, {
    multipart: { files: { name: 'pixel.png', mimeType: 'image/png', buffer: PNG }, inline: 'false' }
  })
  const mediaID = (Array.isArray(media) ? media[0] : media).id
  await ag.call('POST', `/api/v1/conversations/${conv.uuid}/messages`, { message: BREAKOUT, private: true, sender_type: 'agent' })
  await ag.call('POST', `/api/v1/conversations/${conv.uuid}/messages`, { message: TEMPLATE, private: true, sender_type: 'agent' })
  await ag.call('POST', `/api/v1/conversations/${conv.uuid}/messages`, { message: `<p>image-${run}</p>`, private: true, sender_type: 'agent', attachments: [mediaID] })

  // What was stored.
  const msgs = await ag.call('GET', `/api/v1/conversations/${conv.uuid}/messages?page=1&page_size=50`)
  const list = Array.isArray(msgs) ? msgs : msgs.results || msgs.messages || []
  const find = (tag) => list.find((m) => (m.content || '').includes(tag))
  const tmpl = find(`tmpl-${run}`)
  if (!tmpl) fail('the template note was not found')
  if (/<style|<img/i.test(tmpl.content)) fail(`the template note stored markup: ${tmpl.content}`)
  if (!tmpl.content.includes('&lt;img src=x onerror=window.__ran=1&gt;')) fail(`the template note's output isn't escaped: ${tmpl.content}`)
  ok('an agent\'s note: {{ "<style>..." }} and the contact\'s name are stored escaped')
  const sysNote = find(`system-${run}`)
  if (!sysNote || !sysNote.content.includes('{{ .Contact.FirstName }}')) fail(`the System note was rendered: ${sysNote?.content}`)
  ok('the System user\'s note is stored as it is, braces and all')

  // The app in the browser, as the agent.
  const page = await ag.ctx.newPage()
  const problems = []
  await ag.ctx.addInitScript(() => {
    window.__ran = 0
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} @${(e.sourceFile || "").split("/").pop()}:${e.lineNumber}:${e.columnNumber}`))
  })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`)
  })
  const visit = async (path, ready) => {
    await page.goto(base + path)
    await ready()
    await page.waitForTimeout(1500) // let late requests (images, websocket) happen
    const { ran, csp } = await page.evaluate(() => ({ ran: window.__ran, csp: window.__csp }))
    if (ran) fail(`${path}: a payload ran`)
    if (csp.length) fail(`${path}: CSP violations: ${csp.join(' | ')}`)
    if (problems.length) fail(`${path}: ${problems.join(' | ')}`)
    ok(`${path}: loaded, nothing ran, no CSP violation`)
  }
  await visit('/inboxes/assigned', () => page.waitForLoadState('networkidle'))
  await visit(`/inboxes/all/conversation/${conv.uuid}`, () => page.getByText(`image-${run}`, { exact: true }).last().waitFor())
  const text = await page.locator('body').innerText()
  if (!text.includes(`breakout-${run}`)) fail('the breakout note is not shown')
  if (!text.includes('<style>p{}</style>')) fail('the escaped template output is not shown as text')
  const imgLoaded = await page.evaluate(() =>
    [...document.querySelectorAll('img')].some((i) => i.complete && i.naturalWidth > 0 && /\/uploads\//.test(i.src))
  )
  if (!imgLoaded) fail('the image attachment did not load')
  ok('the conversation shows the notes as text and the image attachment')
  await visit('/admin/general', () => page.waitForLoadState('networkidle'))

  // The login page, signed out.
  const anon = await browser.newContext()
  await anon.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} @${(e.sourceFile || "").split("/").pop()}:${e.lineNumber}:${e.columnNumber}`))
  })
  const lp = await anon.newPage()
  await lp.goto(base + '/')
  await lp.waitForLoadState('networkidle')
  const lcsp = await lp.evaluate(() => window.__csp)
  if (lcsp.length) fail(`login page: CSP violations: ${lcsp.join(' | ')}`)
  ok('login page: no CSP violation')
} catch (e) {
  failed = true
  console.error(`FAIL ${e.message}`)
} finally {
  await browser.close()
}
console.log(failed ? 'security smoke: FAILED' : 'security smoke: passed')
process.exit(failed ? 1 : 0)
