import { describe, expect, it } from 'vitest'
import {
  accountReason,
  countAccountAlerts,
  accountStatus,
  connectedAt,
  displayName,
  errorMessage,
  historyEntries,
  isLoginFinished,
  isValidAccountName,
  canaryChecks,
  loginPending,
  muteLabel,
  needsSignIn,
  pageSlug,
  oauthFinished,
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

  it('lists connection history with an icon per cause and repeat counts', () => {
    const account = {
      history: [
        { at: '2026-10-20T12:37:23Z', kind: 'session_expired', message: 'Facebook đã huỷ phiên' },
        { at: '2026-10-20T12:35:37Z', kind: 'network', message: 'mất mạng', count: 3, last_at: '2026-10-20T12:36:00Z' },
        { at: 'bad', kind: 'weird' }
      ]
    }
    const entries = historyEntries(account, 'vi-VN')
    expect(entries.map((e) => e.icon)).toEqual(['🔴', '📶', '🟠'])
    expect(entries[0].message).toBe('Facebook đã huỷ phiên')
    expect(entries[0].count).toBe(0)
    expect(entries[1].count).toBe(3)
    expect(entries[1].lastAt).not.toBe('')
    expect(entries[2].at).toBe('')
    expect(historyEntries({}, 'vi-VN')).toEqual([])
  })

  it('detects a finished Zalo OA grant by its new connected_at', () => {
    const list = (at) => [{ channel: 'zalooa', accounts: [{ name: 'shop', profile: at ? { connected_at: at } : {} }] }]
    expect(connectedAt(list('2026-10-21T10:00:00Z'), 'zalooa', 'shop')).toBe('2026-10-21T10:00:00Z')
    expect(connectedAt(list(''), 'zalooa', 'other')).toBe('')
    expect(oauthFinished(list(''), 'zalooa', 'shop', '')).toBe(false)
    expect(oauthFinished(list('2026-10-21T10:00:00Z'), 'zalooa', 'shop', '')).toBe(true)
    expect(oauthFinished(list('2026-10-21T10:00:00Z'), 'zalooa', 'shop', '2026-10-21T10:00:00Z')).toBe(false)
    expect(oauthFinished(list('2026-10-21T11:00:00Z'), 'zalooa', 'shop', '2026-10-21T10:00:00Z')).toBe(true)
  })

  it('suggests a Fanpage Web account name from the Page name', () => {
    expect(pageSlug('VetGo phần mềm quản lý phòng khám thú y')).toBe('vetgo-phan-mem')
    expect(pageSlug('8 Gian đồ Ăn Vặt,  Sinh Tố, Nước Ép')).toBe('8-gian-do')
    expect(pageSlug('Đà Lạt  Pet Shop!')).toBe('da-lat-pet')
    expect(pageSlug('***')).toBe('trang')
    expect(pageSlug('a'.repeat(30) + ' bc')).toBe('a'.repeat(20))
    expect(pageSlug('Bamboo Beauty Spa')).toBe('bamboo-beauty-spa')
    expect(isValidAccountName(pageSlug('VetGo Test'))).toBe(true)
  })

  it('waits for a Fanpage Web login until an agent has listed its Pages', () => {
    expect(loginPending([], 'owner')).toBe(true)
    expect(loginPending([{ name: 'owner', state: 'listing' }], 'owner')).toBe(true)
    expect(loginPending([{ name: 'owner', state: 'ok' }], 'owner')).toBe(false)
    expect(loginPending([{ name: 'owner', state: 'error' }], 'owner')).toBe(false)
  })

  it('describes how long alerts stay muted', () => {
    const t = (key, args) => key + (args ? ' ' + args.at : '')
    expect(muteLabel(0, t, 'vi-VN')).toBe('admin.channelAlerts.mutedForever')
    expect(muteLabel(1793530800, t, 'vi-VN')).toMatch(/^admin\.channelAlerts\.mutedUntil \S/)
  })

  it('lists canary problems and checks with their details', () => {
    const run = {
      report: {
        problems: ';- container fb-bot: exited/none;',
        canary: {
          checks: [
            { check: 'customer fbweb text', ok: true, http: 200, latency_s: 0.7, error: null },
            { check: 'fbweb pages running', ok: false, not_running: { 'vetgo-test': 'dropped' }, bad: {} }
          ]
        }
      }
    }
    expect(canaryChecks(run)).toEqual([
      { check: 'container fb-bot: exited/none', ok: false, detail: '' },
      { check: 'customer fbweb text', ok: true, detail: 'http: 200, latency_s: 0.7' },
      { check: 'fbweb pages running', ok: false, detail: 'not_running: {"vetgo-test":"dropped"}' }
    ])
    expect(canaryChecks({})).toEqual([])
  })
})
