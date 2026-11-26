// Helpers for the channel accounts page (omnichannel fork). The gateway exposes
// /gw/accounts on the Libredesk origin; bots answer in Vietnamese. The pure
// rules live in omni-core (shared with the Vetgo app); this file maps their
// codes to Libredesk badges, Tailwind classes and i18n keys.
import {
  accountStatus as accountStatusCode,
  accountState,
  formatShortTime,
  historyEntries as historyItems,
  installerErrorText,
  installerFilename,
  installerPath
} from '@omni-core'

export {
  ACCOUNT_NAME_PATTERN,
  needsSignIn,
  accountReason,
  isValidAccountName,
  isLoginFinished,
  accountDisplayName as displayName,
  accountNeedsAttention,
  countAccountAlerts,
  connectedAt,
  oauthFinished,
  pageSlug,
  loginPending,
  canaryChecks,
  installerFilename
} from '@omni-core'

// Account status -> badge variant and i18n key.
const VARIANTS = {
  running: 'success',
  starting: 'secondary',
  retrying: 'secondary',
  dropped: 'destructive',
  stopped: 'outline',
  disconnected: 'destructive'
}

const badge = (status) => ({ variant: VARIANTS[status], key: `admin.channelAccounts.state.${status}` })

// Bot account state -> badge (unknown states show as stopped).
export function stateInfo (state) {
  return badge(accountState(state))
}

// Badge for an account: a dropped account is "Signed out" only when the
// session expired, otherwise it lost its connection and Reconnect may help.
export function accountStatus (account) {
  return badge(accountStatusCode(account))
}

// Error text from a gateway/bot response ({error} or {message}) or axios error.
export function errorMessage (error) {
  const data = error?.response?.data
  if (data && typeof data === 'object') return data.error || data.message || error.message
  if (typeof data === 'string' && data.trim()) return data.trim()
  return error?.message || 'Error'
}

// Connection history (newest first) with a Tailwind tone per level.
const TONES = {
  info: 'text-muted-foreground',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-destructive'
}

export function historyEntries (account, locale) {
  return historyItems(account, locale).map(({ icon, level, at, lastAt, count, message }) => ({
    icon,
    tone: TONES[level],
    at,
    lastAt,
    count,
    message
  }))
}

// Alerts page: when a mute ends (Unix seconds, 0 = until switched back on).
export function muteLabel (until, t, locale) {
  if (!until) return t('admin.channelAlerts.mutedForever')
  return t('admin.channelAlerts.mutedUntil', { at: formatShortTime(until * 1000, locale) })
}

// SMS: per-branch installer from the gateway (one exe with the link, or a zip for old pins).
export function installerUrl (name) {
  return installerPath(name)
}

// Error text from a failed installer response (see installerErrorText).
export async function installerError (response) {
  let text = ''
  try {
    text = await response.text()
  } catch {
    text = ''
  }
  return installerErrorText(response.status, text)
}

// Download the branch's installer with the admin session cookie. Returns
// {blob, filename}; throws Error(message from the server) on failure.
export async function fetchInstaller (name, fetchImpl = (...args) => window.fetch(...args)) {
  const response = await fetchImpl(installerUrl(name), { credentials: 'include' })
  if (!response.ok) throw new Error(await installerError(response))
  const blob = await response.blob()
  return { blob, filename: installerFilename(response.headers.get('Content-Disposition'), name) }
}

// Save a blob as a file through a temporary anchor.
export function saveBlob (blob, filename, doc = document) {
  const url = URL.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  doc.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Branch codes (gateway /gw/settings/branches): one per "<channel>/<account>", the brandId of the
// Vetgo app. A gateway without the route (404) or any other failure hides the field.
export const BRANCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function branchKey (channel, account) {
  return `${channel}/${account}`
}

// Empty means "no branch" (remove); otherwise the code must match the gateway's pattern.
export function isValidBranchId (value) {
  const v = (value || '').trim()
  return v === '' || BRANCH_ID_PATTERN.test(v)
}

export function branchSettingsFrom (data) {
  const branches = data && typeof data.branches === 'object' && data.branches ? data.branches : {}
  return { available: true, branches: { ...branches } }
}

export function noBranchSettings () {
  return { available: false, branches: {} }
}
