import { describe, expect, it } from 'vitest'
import {
  accountDisplayName,
  accountNeedsAttention,
  accountReason,
  accountState,
  accountStatus,
  canaryChecks,
  connectedAt,
  countAccountAlerts,
  historyEntries,
  installerErrorText,
  installerFilename,
  installerPath,
  isLoginFinished,
  isValidAccountName,
  loginPending,
  oauthFinished,
  pageSlug
} from './index'

describe('account status codes', () => {
  it('keeps known states and shows unknown ones as stopped', () => {
    expect(accountState('running')).toBe('running')
    expect(accountState('retrying')).toBe('retrying')
    expect(accountState('weird')).toBe('stopped')
    expect(accountState(undefined)).toBe('stopped')
    // Không nhận khoá của Object.prototype.
    expect(accountState('toString')).toBe('stopped')
  })

  it('tells signed out from disconnected', () => {
    expect(accountStatus({ state: 'dropped', error: { kind: 'session_expired' } })).toBe('dropped')
    expect(accountStatus({ state: 'dropped', error: { kind: 'network' } })).toBe('disconnected')
    expect(accountStatus({ state: 'running' })).toBe('running')
    expect(accountStatus(null)).toBe('stopped')
  })

  it('shows the reason only while not running', () => {
    expect(accountReason({ state: 'running', error: { message: 'x' } })).toBe('')
    expect(accountReason({ state: 'retrying', error: { message: 'Mất mạng' } })).toBe('Mất mạng')
    expect(accountReason(null)).toBe('')
  })

  it('counts accounts that need an admin', () => {
    const channels = [
      { channel: 'zalo', accounts: [{ state: 'dropped' }, { state: 'running' }] },
      { channel: 'facebook', accounts: [{ state: 'running', error: { kind: 'session_expired' } }] },
      { channel: 'sms' }
    ]
    expect(countAccountAlerts(channels)).toBe(2)
    expect(countAccountAlerts(null)).toBe(0)
    expect(accountNeedsAttention(undefined)).toBe(false)
  })

  it('names accounts and checks names and logins', () => {
    expect(accountDisplayName({ name: 'acc2', profile: { displayName: 'Shop' } })).toBe('Shop')
    expect(accountDisplayName({ name: 'acc2' })).toBe('acc2')
    expect(isValidAccountName('acc-2.x')).toBe(true)
    expect(isValidAccountName('-acc')).toBe(false)
    expect(isLoginFinished('busy')).toBe(true)
    expect(isLoginFinished('waiting_scan')).toBe(false)
    expect(isLoginFinished(null)).toBe(false)
  })
})

describe('account history', () => {
  it('maps kinds to an icon and a level, unknown as disconnected', () => {
    const entries = historyEntries(
      {
        history: [
          { at: '2026-11-20T03:04:00Z', kind: 'session_expired', message: 'Đăng xuất' },
          { at: '2026-11-20T03:00:00Z', kind: 'network', count: 3, last_at: '2026-11-20T03:02:00Z' },
          { at: 'not a date', kind: 'constructor' }
        ]
      },
      'vi-VN'
    )
    expect(entries.map((e) => [e.kind, e.icon, e.level])).toEqual([
      ['session_expired', '🔴', 'error'],
      ['network', '📶', 'warn'],
      ['disconnected', '🟠', 'warn']
    ])
    expect(entries[0]?.message).toBe('Đăng xuất')
    expect(entries[0]?.at).not.toBe('')
    expect(entries[0]?.lastAt).toBe('')
    expect(entries[1]?.count).toBe(3)
    expect(entries[1]?.lastAt).not.toBe('')
    expect(entries[2]?.at).toBe('')
    expect(historyEntries({ history: null })).toEqual([])
  })
})

describe('Zalo OA, Fanpage Web, canary, installer', () => {
  it('sees a new OA grant', () => {
    const channels = [{ channel: 'zalooa', accounts: [{ name: 'oa1', profile: { connected_at: 't2' } }] }]
    expect(connectedAt(channels, 'zalooa', 'oa1')).toBe('t2')
    expect(connectedAt(channels, 'zalooa', 'oa2')).toBe('')
    expect(oauthFinished(channels, 'zalooa', 'oa1', 't1')).toBe(true)
    expect(oauthFinished(channels, 'zalooa', 'oa1', 't2')).toBe(false)
  })

  it('suggests short Page names and waits for listing logins', () => {
    expect(pageSlug('VetGo phần mềm quản lý')).toBe('vetgo-phan-mem')
    expect(pageSlug('Đường')).toBe('duong')
    expect(pageSlug('')).toBe('trang')
    expect(loginPending([{ name: 'a', state: 'listing' }], 'a')).toBe(true)
    expect(loginPending([{ name: 'a', state: 'ready' }], 'a')).toBe(false)
    expect(loginPending([], 'a')).toBe(true)
  })

  it('lists server problems before the canary checks', () => {
    const checks = canaryChecks({
      report: {
        problems: '- container x down; ',
        canary: { checks: [{ check: 'send', ok: true, ms: 120, empty: '', list: [], obj: {} }] }
      }
    })
    expect(checks).toEqual([
      { check: 'container x down', ok: false, detail: '' },
      { check: 'send', ok: true, detail: 'ms: 120' }
    ])
    expect(canaryChecks(null)).toEqual([])
  })

  it('reads the installer name and error', () => {
    expect(installerPath('q 1')).toBe('/gw/accounts/sms/q%201/installer')
    expect(installerFilename(`attachment; filename*=UTF-8''Vetgo%20Q1.zip`, 'q1')).toBe('Vetgo Q1.zip')
    expect(installerFilename('attachment; filename="../x.zip"', 'q1')).toBe('x.zip')
    expect(installerFilename('', 'q1')).toBe('Vetgo-Phone-q1-setup.exe')
    expect(installerFilename('attachment; filename="Vetgo-Phone-q1-setup.exe"', 'q1')).toBe('Vetgo-Phone-q1-setup.exe')
    expect(installerErrorText(501, '{"error":"Chưa cấu hình bộ cài"}')).toBe('Chưa cấu hình bộ cài')
    expect(installerErrorText(500, 'boom')).toBe('boom')
    expect(installerErrorText(502, '<html>')).toBe('HTTP 502')
    expect(installerErrorText(503, null)).toBe('HTTP 503')
  })
})
