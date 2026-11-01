// Helpers for the channel accounts page (omnichannel fork). The gateway exposes
// /gw/accounts on the Libredesk origin; bots answer in Vietnamese.

export const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

// Bot account state -> badge variant and i18n key.
const STATES = {
  running: { variant: 'success', key: 'admin.channelAccounts.state.running' },
  starting: { variant: 'secondary', key: 'admin.channelAccounts.state.starting' },
  retrying: { variant: 'secondary', key: 'admin.channelAccounts.state.retrying' },
  dropped: { variant: 'destructive', key: 'admin.channelAccounts.state.dropped' },
  stopped: { variant: 'outline', key: 'admin.channelAccounts.state.stopped' }
}

export function stateInfo (state) {
  return STATES[state] || STATES.stopped
}

// The bot reports its last error as {kind, message}; "session_expired" means
// the platform signed the account out, so only signing in again helps.
export function needsSignIn (account) {
  return account?.error?.kind === 'session_expired'
}

// Badge for an account: a dropped account is "Signed out" only when the
// session expired, otherwise it lost its connection and Reconnect may help.
export function accountStatus (account) {
  if (account?.state === 'dropped' && !needsSignIn(account)) {
    return { variant: 'destructive', key: 'admin.channelAccounts.state.disconnected' }
  }
  return stateInfo(account?.state)
}

// Reason line under the account name (hidden while connected).
export function accountReason (account) {
  if (!account || account.state === 'running') return ''
  return account.error?.message || ''
}

export function isValidAccountName (name) {
  return ACCOUNT_NAME_PATTERN.test(name || '')
}

// Login session states that need no more polling.
export function isLoginFinished (status) {
  return ['success', 'error', 'cancelled', 'busy'].includes(status)
}

// Error text from a gateway/bot response ({error} or {message}) or axios error.
export function errorMessage (error) {
  const data = error?.response?.data
  if (data && typeof data === 'object') return data.error || data.message || error.message
  if (typeof data === 'string' && data.trim()) return data.trim()
  return error?.message || 'Error'
}

export function displayName (account) {
  return account?.profile?.displayName || account?.name || ''
}

// Accounts that need an admin: signed out, or dropped after giving up retrying.
export function accountNeedsAttention (account) {
  return needsSignIn(account) || account?.state === 'dropped'
}

// countAccountAlerts counts such accounts across the /gw/accounts channels.
export function countAccountAlerts (channels) {
  return (channels || []).reduce(
    (n, c) => n + (c.accounts || []).filter(accountNeedsAttention).length,
    0
  )
}

// Connection history from the bot (newest first): {at, kind, message, count?,
// last_at?}. Each kind gets an icon so the cause of a drop is easy to scan.
const HISTORY_KINDS = {
  connected: { icon: '🟢', tone: 'text-muted-foreground' },
  manual: { icon: '🔁', tone: 'text-muted-foreground' },
  network: { icon: '📶', tone: 'text-amber-600 dark:text-amber-400' },
  disconnected: { icon: '🟠', tone: 'text-amber-600 dark:text-amber-400' },
  platform: { icon: '⚠️', tone: 'text-destructive' },
  session_expired: { icon: '🔴', tone: 'text-destructive' }
}

export function historyEntries (account, locale) {
  const time = (value) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
  return (Array.isArray(account?.history) ? account.history : []).map((item) => ({
    ...(HISTORY_KINDS[item.kind] || HISTORY_KINDS.disconnected),
    at: time(item.at),
    lastAt: item.count > 1 ? time(item.last_at) : '',
    count: item.count > 1 ? item.count : 0,
    message: item.message || ''
  }))
}

// Zalo OA: the OA admin grants access on Zalo's page and the bot finishes on
// its callback. connectedAt is the account's last grant time (or ''); the grant
// is done once the account shows a different one.
export function connectedAt (channels, channel, name) {
  const found = (channels || []).find((c) => c.channel === channel)
  const account = (found?.accounts || []).find((a) => a.name === name)
  return account?.profile?.connected_at || ''
}

export function oauthFinished (channels, channel, name, before) {
  const now = connectedAt(channels, channel, name)
  return now !== '' && now !== before
}

// Fanpage Web: suggested account name for a Page ("VetGo phần mềm" -> "vetgo-phan-mem").
export function pageSlug (name) {
  const slug = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'trang'
}

// Fanpage Web: a login still listing its Pages (or not yet seen by an agent).
export function loginPending (logins, name) {
  const login = (logins || []).find((l) => l.name === name)
  return !login || login.state === 'listing'
}

// Alerts page: when a mute ends (Unix seconds, 0 = until switched back on).
export function muteLabel (until, t, locale) {
  if (!until) return t('admin.channelAlerts.mutedForever')
  const at = new Date(until * 1000).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return t('admin.channelAlerts.mutedUntil', { at })
}

// Daily canary page: the checks of one stored run, with problems found by the
// server script (containers, logs) first; detail is the check's extra fields.
export function canaryChecks (run) {
  const report = run?.report || {}
  const problems = String(report.problems || '')
    .split(';')
    .map((p) => p.trim().replace(/^- /, ''))
    .filter(Boolean)
    .map((p) => ({ check: p, ok: false, detail: '' }))
  const checks = (report.canary?.checks || []).map(({ check, ok, ...rest }) => ({
    check,
    ok: !!ok,
    detail: Object.entries(rest)
      .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length) &&
        !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length))
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ')
  }))
  return [...problems, ...checks]
}
