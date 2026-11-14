# Security smoke

Proofs for the fixes of security batch 1. Run them after a change to message rendering,
templates, headers or the frontend build. They need Playwright: the frontend's, or set
`PLAYWRIGHT_DIR` to a folder with `node_modules/@playwright/test` (the omnichannel repo's
`omi-admin/web` is found on its own when both repos sit side by side).

- `node scripts/security-smoke/sanitizer.mjs`: no Libredesk needed. Each payload in Chromium,
  through lettersanitizer alone (the `<style>` breakout runs) and with `safeHtml` in front
  (nothing runs).
- `LD_URL=http://localhost:9311 LD_SYSTEM_PASSWORD=... node scripts/security-smoke/app.mjs`: a
  running Libredesk built from this repo, on a throwaway database (it creates an inbox, an
  agent, a contact and notes; never point it at a clinic). Its `app.root_url` and
  `app.favicon_url` settings must be its own address. Checks that the notes run nothing, that
  template output is escaped, that System notes are stored as sent, and that the login, inbox,
  conversation and settings pages load with no CSP violation.

- `LD_URL=http://localhost:9313 LD_SYSTEM_PASSWORD=... node scripts/security-smoke/batch2.mjs`:
  security batch 2 on a throwaway instance whose config has `app.system_login_via_proxy = false`
  (and `app.trusted_proxies = []`). Checks that spoofed client-IP headers don't escape the login
  limit, System signs in directly but not through a proxy, users:manage can't touch System,
  Admins, the Admin role or the caller's own role, a password set by an admin ends the agent's
  session, `?next=` stays on the site, CSRF covers writes with a Strict cookie and POST logout,
  password reset answers the same for any email, and 10 failures lock an email (429 even with
  the right password, unknown emails alike) without touching other accounts. Takes a little over a minute (it waits out
  the login limit before the reset check).

A throwaway instance: build (`cd frontend && pnpm build:main && pnpm build:widget`, then
`go build -o /tmp/ld ./cmd && stuffbin -a stuff -in /tmp/ld -out /tmp/ld frontend/dist i18n schema.sql static`),
point a copy of `config.sample.toml` at an empty Postgres database and a Redis, then
`LIBREDESK_SYSTEM_USER_PASSWORD=... /tmp/ld --install --idempotent-install --yes --config c.toml`,
`/tmp/ld --upgrade --yes --config c.toml` and `/tmp/ld --config c.toml`.
