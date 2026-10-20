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
