import { describe, expect, it } from 'vitest'
import {
  accountReason,
  countAccountAlerts,
  accountStatus,
  connectedAt,
  displayName,
  errorMessage,
  fetchInstaller,
  historyEntries,
  installerError,
  installerFilename,
  installerUrl,
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

  it('names the SMS installer from Content-Disposition', () => {
    expect(installerFilename('attachment; filename="Vetgo-Phone-q1.zip"', 'q1')).toBe('Vetgo-Phone-q1.zip')
    expect(installerFilename('attachment; filename=plain.zip', 'q1')).toBe('plain.zip')
    expect(installerFilename("attachment; filename=\"x.zip\"; filename*=UTF-8''Vetgo%20Phone%20Qu%E1%BA%ADn%201.zip", 'q1'))
      .toBe('Vetgo Phone Quận 1.zip')
    expect(installerFilename('attachment; filename="..\\\\evil/../a b.zip"', 'q1')).toBe('a b.zip')
    expect(installerFilename('attachment', 'q1')).toBe('Vetgo-Phone-q1-setup.exe')
    expect(installerFilename(null, 'shop.2')).toBe('Vetgo-Phone-shop.2-setup.exe')
    expect(installerFilename("attachment; filename*=UTF-8''%E0%A4%A", 'q1')).toBe('Vetgo-Phone-q1-setup.exe')
    expect(installerUrl('a b')).toBe('/gw/accounts/sms/a%20b/installer')
  })

  it('reads the gateway error of a failed installer download', async () => {
    const res = (status, body) => ({ status, ok: false, text: async () => body })
    expect(await installerError(res(501, '{"error":"Máy chủ chưa cấu hình bộ cài."}'))).toBe('Máy chủ chưa cấu hình bộ cài.')
    expect(await installerError(res(403, 'forbidden\n'))).toBe('forbidden')
    expect(await installerError(res(502, '<html>Bad gateway</html>'))).toBe('HTTP 502')
    expect(await installerError(res(500, ''))).toBe('HTTP 500')
  })

  it('downloads the installer with the session cookie or throws the server message', async () => {
    const calls = []
    const ok = async (url, opts) => {
      calls.push([url, opts])
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'attachment; filename="Vetgo-Phone-q1.zip"' },
        blob: async () => 'ZIP'
      }
    }
    expect(await fetchInstaller('q1', ok)).toEqual({ blob: 'ZIP', filename: 'Vetgo-Phone-q1.zip' })
    expect(calls).toEqual([['/gw/accounts/sms/q1/installer', { credentials: 'include' }]])
    const notConfigured = async () => ({ ok: false, status: 501, text: async () => '{"error":"Chưa có bộ cài"}' })
    await expect(fetchInstaller('q1', notConfigured)).rejects.toThrow('Chưa có bộ cài')
  })
})
