import { describe, expect, it } from 'vitest'
import { displayName, errorMessage, isLoginFinished, isValidAccountName, stateInfo } from './channelAccounts.js'

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
})
