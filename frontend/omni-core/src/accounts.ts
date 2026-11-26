// Tài khoản kênh (gateway /gw/accounts): trạng thái, lý do, lịch sử kết nối, Fanpage Web, Zalo OA,
// canary, bộ cài SMS. Hàm trả mã ngữ nghĩa; mỗi giao diện tự đổi mã ra nhãn, màu, chữ.

import type {
  AccountHistoryItem,
  AccountState,
  CanaryRunLike,
  ChannelAccountLike,
  ChannelGroupLike,
  FbwebLoginLike
} from './types'

export const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export const ACCOUNT_STATES: readonly AccountState[] = [
  'running',
  'starting',
  'retrying',
  'dropped',
  'stopped'
]

// accountState: trạng thái bot báo, trạng thái lạ coi là stopped.
export function accountState(state: string | null | undefined): AccountState {
  return (ACCOUNT_STATES as readonly string[]).includes(state || '')
    ? (state as AccountState)
    : 'stopped'
}

// needsSignIn: bot báo lỗi cuối {kind, message}; "session_expired" là nền tảng đã đăng xuất tài
// khoản, chỉ đăng nhập lại mới được.
export function needsSignIn(account: ChannelAccountLike | null | undefined): boolean {
  return account?.error?.kind === 'session_expired'
}

/** Trạng thái hiện cho tài khoản: thêm `disconnected` (rớt kết nối, Kết nối lại có thể được). */
export type AccountStatus = AccountState | 'disconnected'

// accountStatus: tài khoản dropped chỉ là "Đã đăng xuất" khi phiên hết hạn; còn lại là mất kết nối.
export function accountStatus(account: ChannelAccountLike | null | undefined): AccountStatus {
  if (account?.state === 'dropped' && !needsSignIn(account)) return 'disconnected'
  return accountState(account?.state)
}

// accountReason: dòng lý do dưới tên tài khoản (ẩn khi đang chạy).
export function accountReason(account: ChannelAccountLike | null | undefined): string {
  if (!account || account.state === 'running') return ''
  return account.error?.message || ''
}

export function isValidAccountName(name: string | null | undefined): boolean {
  return ACCOUNT_NAME_PATTERN.test(name || '')
}

// isLoginFinished: phiên đăng nhập không cần hỏi tiếp.
export function isLoginFinished(status: string | null | undefined): boolean {
  return ['success', 'error', 'cancelled', 'busy'].includes(status || '')
}

export function accountDisplayName(account: ChannelAccountLike | null | undefined): string {
  return account?.profile?.displayName || account?.name || ''
}

// accountNeedsAttention: cần quản trị viên: đã đăng xuất, hay dropped sau khi hết lượt thử lại.
export function accountNeedsAttention(account: ChannelAccountLike | null | undefined): boolean {
  return needsSignIn(account) || account?.state === 'dropped'
}

// countAccountAlerts: số tài khoản như vậy trên mọi kênh của /gw/accounts.
export function countAccountAlerts(channels: readonly ChannelGroupLike[] | null | undefined): number {
  return (channels || []).reduce(
    (n, c) => n + (c.accounts || []).filter(accountNeedsAttention).length,
    0
  )
}

// formatShortTime: "dd/mm hh:mm" theo `locale`; '' khi không đọc được mốc.
export function formatShortTime(value: string | number | Date | null | undefined, locale?: string): string {
  const date = new Date(value as string)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Lịch sử kết nối do bot báo (mới nhất trước). Mỗi loại một biểu tượng để dễ thấy lý do rớt.
export type HistoryKind =
  | 'connected'
  | 'manual'
  | 'network'
  | 'disconnected'
  | 'platform'
  | 'session_expired'

/** Mức độ của một mốc: giao diện đổi ra màu (info: mờ, warn: cam, error: đỏ). */
export type HistoryLevel = 'info' | 'warn' | 'error'

export const HISTORY_KINDS: Readonly<Record<HistoryKind, { icon: string; level: HistoryLevel }>> = {
  connected: { icon: '🟢', level: 'info' },
  manual: { icon: '🔁', level: 'info' },
  network: { icon: '📶', level: 'warn' },
  disconnected: { icon: '🟠', level: 'warn' },
  platform: { icon: '⚠️', level: 'error' },
  session_expired: { icon: '🔴', level: 'error' }
}

export interface HistoryEntry {
  kind: HistoryKind
  icon: string
  level: HistoryLevel
  at: string
  lastAt: string
  count: number
  message: string
}

// historyEntries: lịch sử của tài khoản, loại lạ coi là disconnected; `count` > 1 khi bot gộp các lần
// giống nhau (kèm mốc cuối `lastAt`).
export function historyEntries(
  account: ChannelAccountLike | null | undefined,
  locale?: string
): HistoryEntry[] {
  const items: AccountHistoryItem[] = Array.isArray(account?.history) ? account.history : []
  return items.map((item) => {
    const known = !!item.kind && Object.prototype.hasOwnProperty.call(HISTORY_KINDS, item.kind)
    const kind = (known ? item.kind : 'disconnected') as HistoryKind
    const many = (item.count || 0) > 1
    return {
      kind,
      ...HISTORY_KINDS[kind],
      at: formatShortTime(item.at, locale),
      lastAt: many ? formatShortTime(item.last_at, locale) : '',
      count: many ? (item.count as number) : 0,
      message: item.message || ''
    }
  })
}

// Zalo OA: quản trị OA cấp quyền trên trang của Zalo, bot hoàn tất ở callback. connectedAt là lần cấp
// quyền cuối của tài khoản (hay ''); cấp xong khi tài khoản có mốc khác.
export function connectedAt(
  channels: readonly ChannelGroupLike[] | null | undefined,
  channel: string,
  name: string
): string {
  const found = (channels || []).find((c) => c.channel === channel)
  const account = (found?.accounts || []).find((a) => a.name === name)
  return account?.profile?.connected_at || ''
}

export function oauthFinished(
  channels: readonly ChannelGroupLike[] | null | undefined,
  channel: string,
  name: string,
  before: string
): boolean {
  const now = connectedAt(channels, channel, name)
  return now !== '' && now !== before
}

// Fanpage Web: tên tài khoản gợi ý cho một Trang, ngắn vì nằm trong tên inbox ("VetGo phần mềm quản
// lý" -> "vetgo-phan-mem"): 3 từ đầu, tối đa 20 ký tự, không cắt giữa từ trừ khi từ đầu dài hơn.
export function pageSlug(name: string | null | undefined): string {
  const words = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 3)
  let slug = ''
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w
    if (next.length > 20) break
    slug = next
  }
  if (!slug && words.length) slug = (words[0] ?? '').slice(0, 20)
  return slug || 'trang'
}

// Fanpage Web: lần đăng nhập còn đang liệt kê Trang (hay nhân viên chưa thấy).
export function loginPending(logins: readonly FbwebLoginLike[] | null | undefined, name: string): boolean {
  const login = (logins || []).find((l) => l.name === name)
  return !login || login.state === 'listing'
}

export interface CanaryCheck {
  check: string
  ok: boolean
  detail: string
}

// canaryChecks: các mục của một lần chạy canary, lỗi do script trên máy tìm ra (container, log) đứng
// trước; detail là các trường thêm của mục.
export function canaryChecks(run: CanaryRunLike | null | undefined): CanaryCheck[] {
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
      .filter(
        ([, v]) =>
          v !== null &&
          v !== undefined &&
          v !== '' &&
          !(Array.isArray(v) && !v.length) &&
          !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)
      )
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ')
  }))
  return [...problems, ...checks]
}

// SMS: bộ cài của một chi nhánh (GET /gw/accounts/sms/{name}/installer). Gateway tạo mã liên kết mới
// mỗi lần tải, nên máy đã liên kết bằng mã cũ mất kết nối tới khi cài lại gói mới.
export function installerPath(name: string): string {
  return `/gw/accounts/sms/${encodeURIComponent(name)}/installer`
}

// installerFilename: tên tệp từ Content-Disposition (ưu tiên filename* theo RFC 5987), bỏ mọi đường dẫn;
// không có thì Vetgo-Phone-<chi nhánh>.zip.
export function installerFilename(header: string | null | undefined, branch: string): string {
  // Gateway trả tên tệp; thiếu thì đặt như bộ cài một tệp (Desktop 0.1.23 trở lên).
  const fallback = `Vetgo-Phone-${branch}-setup.exe`
  const value = String(header || '')
  let name = ''
  const star = value.match(/filename\*\s*=\s*([^;]+)/i)
  if (star) {
    const raw = (star[1] ?? '')
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^[^']*'[^']*'/, '')
    try {
      name = decodeURIComponent(raw)
    } catch {
      name = ''
    }
  }
  if (!name) {
    const plain = value.match(/filename\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]+)/i)
    if (plain) name = plain[2] !== undefined ? plain[2].replace(/\\(.)/g, '$1') : (plain[1] ?? '').trim()
  }
  name = (name.split(/[\\/]/).pop() || '').trim()
  return name || fallback
}

// installerErrorText: lỗi của một lần tải bộ cài hỏng: {error} JSON của gateway (501 khi chưa cấu
// hình bộ cài), không thì thân chữ thuần ngắn, không thì mã HTTP.
export function installerErrorText(status: number, text: string | null | undefined): string {
  const body = text || ''
  try {
    const data = JSON.parse(body)
    if (data && typeof data === 'object' && (data.error || data.message)) {
      return String(data.error || data.message)
    }
  } catch {
    // không phải JSON
  }
  const plain = body.trim()
  if (plain && plain.length < 300 && !plain.startsWith('<')) return plain
  return `HTTP ${status}`
}
