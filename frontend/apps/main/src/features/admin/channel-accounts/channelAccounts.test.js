import { describe, expect, it } from 'vitest'
import {
  accountReason,
  countAccountAlerts,
  accountStatus,
  displayName,
  errorMessage,
  isLoginFinished,
  isValidAccountName,
  needsSignIn,
  stateInfo
} from './channelAccounts.js'

describe('channel accounts helpers', () => {
  it('maps bot states to badges, unknown as stopped', () => {
    expect(stateInfo('running').variant).toBe('success')
    expect(stateInfo('dropped').variant).toBe('destructive')
    expect(stateInfo('weird').key).toBe('admin.channelAccounts.state.stopped')
  })

  it('validates account names like the bots do', () => {
    expect(isValidAccountName('shop_1.vn')).toBe(true)
    expect(isValidAccountName('')).toBe(false)
    expect(isValidAccountName('../etc')).toBe(false)
    expect(isValidAccountName('a'.repeat(65))).toBe(false)
  })

  it('knows when to stop polling', () => {
    expect(isLoginFinished('qr')).toBe(false)
    expect(isLoginFinished('success')).toBe(true)
  })

  it('reads gateway and bot errors', () => {
    expect(errorMessage({ response: { data: { error: 'Thiếu cookie.' } } })).toBe('Thiếu cookie.')
    expect(errorMessage({ response: { data: { ok: false, message: 'Facebook không chấp nhận' } } })).toBe('Facebook không chấp nhận')
    expect(errorMessage({ response: { data: 'forbidden\n' } })).toBe('forbidden')
    expect(errorMessage({ message: 'Network Error' })).toBe('Network Error')
  })

  it('prefers the platform display name', () => {
    expect(displayName({ name: 'acc2', profile: { displayName: 'Nguyễn Văn A' } })).toBe('Nguyễn Văn A')
    expect(displayName({ name: 'acc2', profile: null })).toBe('acc2')
  })

  it('tells signed-out accounts from disconnected ones', () => {
    const expired = { state: 'dropped', error: { kind: 'session_expired', message: 'Phiên hết hạn' } }
    const lost = { state: 'dropped', error: { kind: 'connection', message: 'Lỗi kết nối: x' } }
    expect(needsSignIn(expired)).toBe(true)
    expect(needsSignIn(lost)).toBe(false)
    expect(accountStatus(expired).key).toBe('admin.channelAccounts.state.dropped')
    expect(accountStatus(lost).key).toBe('admin.channelAccounts.state.disconnected')
    expect(accountStatus({ state: 'running' }).variant).toBe('success')
    expect(accountReason(lost)).toBe('Lỗi kết nối: x')
    expect(accountReason({ state: 'running', error: lost.error })).toBe('')
  })

  it('counts accounts that need an admin', () => {
    const channels = [
      { accounts: [{ state: 'running' }, { state: 'retrying', error: { kind: 'session_expired' } }] },
      { accounts: [{ state: 'dropped', error: { kind: 'connection' } }, { state: 'retrying', error: { kind: 'connection' } }] },
      {}
    ]
    expect(countAccountAlerts(channels)).toBe(2)
    expect(countAccountAlerts(null)).toBe(0)
  })
})
