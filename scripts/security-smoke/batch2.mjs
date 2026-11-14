// Proof of security batch 2 on a running Libredesk (built from this repo), through the HTTP API
// only. It creates a role, agents and sign-ins, so run it against a throwaway instance whose
// config has app.system_login_via_proxy = false and app.trusted_proxies = [] (the default),
// never against a clinic's.
//
//   LD_URL=http://localhost:9313 LD_SYSTEM_PASSWORD=... node scripts/security-smoke/batch2.mjs
//
// Checks (exit 1 on the first failure):
//   1. a client changing X-Client-IP / X-Forwarded-For on each try still hits the login limit;
//   2. System signs in directly, but not through a proxy (X-Forwarded-For present);
//   3. a holder of users:manage + roles:manage can't change System, act on an Admin, hand out
//      Admin or edit the role they hold, but can manage an ordinary agent;
//   4. a password set by an admin ends the agent's existing session;
//   5. ?next= to another site lands on the app, not there;
//   6. a write without the CSRF header is refused, the CSRF cookie is SameSite=Strict, GET
//      /logout ends nothing and POST /api/v1/auth/logout ends the session;
//   7. password reset answers the same for an unknown and a known email.
import crypto from 'node:crypto'
import { chromium } from './playwright.mjs'

const base = process.env.LD_URL || 'http://localhost:9313'
const systemPassword = process.env.LD_SYSTEM_PASSWORD
if (!systemPassword) {
  console.error('set LD_SYSTEM_PASSWORD')
  process.exit(2)
}
const run = crypto.randomBytes(3).toString('hex')
const ok = (what) => console.log(`ok   ${what}`)
const fail = (what) => {
  throw new Error(what)
}
const pw = () => `Pw-${crypto.randomBytes(6).toString('hex')}-A1!`

const browser = await (await chromium()).launch()
let failed = false
try {
  const session = async (email, password, headers = {}) => {
    const ctx = await browser.newContext({ baseURL: base })
    await ctx.request.get('/')
    const res = await ctx.request.post('/api/v1/auth/login', { data: { email, password }, headers })
    const csrf = (await ctx.cookies()).find((c) => c.name === 'csrf_token')
    const call = async (method, path, data, extra = {}) => {
      const r = await ctx.request.fetch(path, { method, data, headers: { 'X-CSRFTOKEN': csrf?.value || '' }, maxRedirects: 0, ...extra })
      const body = await r.json().catch(() => ({}))
      return { status: r.status(), data: body.data, body, headers: r.headers() }
    }
    return { ctx, call, loginStatus: res.status(), csrf }
  }
  const must = async (p, what) => {
    const r = await p
    if (r.status >= 300) fail(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    return r.data
  }

  // 2. System directly and through a proxy.
  const sys = await session('System', systemPassword)
  if (sys.loginStatus !== 200) fail(`System direct sign-in: HTTP ${sys.loginStatus}`)
  const proxied = await session('System', systemPassword, { 'X-Forwarded-For': '198.51.100.7' })
  if (proxied.loginStatus === 200) fail('System signed in through a proxy')
  ok(`System signs in directly (200), not through a proxy (${proxied.loginStatus})`)

  // Setup: a Manager role (users:manage, roles:manage), a manager, an Admin, an agent.
  const role = await must(sys.call('POST', '/api/v1/roles', { name: `Manager-${run}`, description: 'smoke', permissions: ['users:manage', 'roles:manage'] }), 'create role')
  const mk = async (email, roles) => {
    const password = pw()
    const a = await must(sys.call('POST', '/api/v1/agents', { first_name: 'Smoke', last_name: run, email, roles, enabled: true, send_welcome_email: false }), `create ${email}`)
    await must(sys.call('PUT', `/api/v1/agents/${a.id}`, { first_name: 'Smoke', last_name: run, email, roles, enabled: true, new_password: password }), `password ${email}`)
    return { ...a, email, password, roles }
  }
  const mgr = await mk(`mgr.${run}@acme.test`, [`Manager-${run}`])
  const admin = await mk(`admin.${run}@acme.test`, ['Admin'])
  const plain = await mk(`plain.${run}@acme.test`, ['Agent'])
  const me = await must(sys.call('GET', '/api/v1/agents/me'), 'System me')

  // 3. Escalation.
  const m = await session(mgr.email, mgr.password)
  const put = (a, extra = {}) => m.call('PUT', `/api/v1/agents/${a.id}`, { first_name: 'X', last_name: run, email: a.email, roles: a.roles, enabled: true, ...extra })
  const refused = [
    ['change System', await m.call('PUT', `/api/v1/agents/${me.id}`, { first_name: 'X', last_name: '', email: `takeover.${run}@acme.test`, roles: ['Admin'], enabled: true, new_password: pw() })],
    ['API key for System', await m.call('POST', `/api/v1/agents/${me.id}/api-key`)],
    ['set an Admin\'s password', await put(admin, { new_password: pw() })],
    ['API key for an Admin', await m.call('POST', `/api/v1/agents/${admin.id}/api-key`)],
    ['give themselves Admin', await put({ ...mgr, roles: ['Admin'] })],
    ['create an Admin', await m.call('POST', '/api/v1/agents', { first_name: 'Y', last_name: run, email: `y.${run}@acme.test`, roles: ['Admin'], enabled: true })],
    ['edit their own role', await m.call('PUT', `/api/v1/roles/${role.id}`, { name: role.name, description: 'x', permissions: ['users:manage', 'roles:manage', 'conversations:read_all'] })]
  ]
  for (const [what, r] of refused) if (r.status !== 403) fail(`manager could ${what}: HTTP ${r.status}`)
  const allowed = await put(plain, { new_password: pw() })
  if (allowed.status !== 200) fail(`manager can't manage an ordinary agent: HTTP ${allowed.status} ${JSON.stringify(allowed.body)}`)
  ok(`users:manage refused on System, Admins, the Admin role and their own role (${refused.length} x 403); allowed on an agent`)

  // 4. A password set by an admin ends the existing session.
  const victim = await mk(`victim.${run}@acme.test`, ['Agent'])
  const v = await session(victim.email, victim.password)
  if ((await v.call('GET', '/api/v1/agents/me')).status !== 200) fail('victim session not working')
  await must(sys.call('PUT', `/api/v1/agents/${victim.id}`, { first_name: 'Smoke', last_name: run, email: victim.email, roles: ['Agent'], enabled: true, new_password: pw() }), 'reset victim')
  const after = await v.call('GET', '/api/v1/agents/me')
  if (after.status === 200) fail('the old session still works after the password was set')
  ok(`an admin setting the password ends the agent's session (${after.status})`)

  // 5. Open redirect.
  const redir = await m.ctx.request.get('/?next=https://evil.example/login', { maxRedirects: 0 })
  const loc = redir.headers().location || ''
  if (loc.includes('evil.example')) fail(`redirected to ${loc}`)
  ok(`?next=https://evil.example goes to ${loc || '(no redirect)'}`)

  // 6. CSRF and logout.
  if (m.csrf?.sameSite !== 'Strict') fail(`csrf cookie SameSite=${m.csrf?.sameSite}`)
  const noToken = await m.ctx.request.fetch('/api/v1/agents/me/availability', { method: 'PUT', data: { status: 'online' } })
  if (noToken.status() !== 403) fail(`a write without the CSRF header: HTTP ${noToken.status()}`)
  await m.ctx.request.get('/logout', { maxRedirects: 0 })
  if ((await m.call('GET', '/api/v1/agents/me')).status !== 200) fail('GET /logout ended the session')
  const out = await m.call('POST', '/api/v1/auth/logout')
  if (out.status !== 200) fail(`POST logout: HTTP ${out.status}`)
  if ((await m.call('GET', '/api/v1/agents/me')).status === 200) fail('the session survived POST logout')
  ok('CSRF cookie SameSite=Strict; write without the header 403; GET /logout harmless; POST logout ends the session')

  // 1. Rate limit with spoofed client headers (the login rule: 30 a minute).
  let limited = 0
  for (let i = 0; i < 40; i++) {
    const r = await browser.newContext({ baseURL: base }).then((c) => c.request.post('/api/v1/auth/login', {
      data: { email: `nobody.${run}@acme.test`, password: 'wrong' },
      headers: { 'X-Client-IP': `10.9.0.${i}`, 'X-Forwarded-For': `10.8.0.${i}`, 'X-Real-Ip': `10.7.0.${i}` }
    }))
    if (r.status() === 429) limited++
  }
  if (limited === 0) fail('40 sign-ins with a different X-Client-IP each were never limited')
  ok(`spoofed client headers don't escape the login limit (${limited} of 40 refused with 429)`)

  // 7. Password reset says nothing about which emails exist (run last: the auth limit is spent).
  await new Promise((r) => setTimeout(r, 61000))
  const reset = async (email) => {
    const c = await browser.newContext({ baseURL: base })
    const t = Date.now()
    const r = await c.request.post('/api/v1/agents/reset-password', { data: { email } })
    return { status: r.status(), body: await r.text(), ms: Date.now() - t }
  }
  const unknown = await reset(`ghost.${run}@acme.test`)
  const known = await reset(plain.email)
  if (unknown.status !== known.status || unknown.body !== known.body) fail(`reset answers differ: ${unknown.status} ${unknown.body} / ${known.status} ${known.body}`)
  ok(`password reset: same answer for an unknown and a known email (${known.status}, ${unknown.ms} ms vs ${known.ms} ms)`)
} catch (e) {
  failed = true
  console.error(`FAIL ${e.message}`)
} finally {
  await browser.close()
}
console.log(failed ? 'security smoke batch 2: FAILED' : 'security smoke batch 2: passed')
process.exit(failed ? 1 : 0)
