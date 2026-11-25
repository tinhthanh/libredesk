// Cuộc gọi trong hộp thư: Zalo (zalo-call), Fanpage Web (fbweb-ls), điện thoại chi nhánh (kênh SMS).
// Chỉ phần quyết định và hằng số; WebRTC, micro, âm thanh và trạng thái phản ứng nằm ở từng giao diện.

import type { RingingCallLike } from './types'

// --- Gọi khách Zalo (gateway /gw/calls, zalo-call) ---

export type CallState = 'idle' | 'starting' | 'dialing' | 'ringing' | 'in_call' | 'ended'

/** Lý do kết thúc zalo-call báo; lý do khác hiện là `error`. */
export const CALL_END_REASONS = [
  'customer_hangup',
  'agent_hangup',
  'no_answer',
  'rejected',
  'busy',
  'cancelled',
  'browser_gone',
  'max_duration',
  'ended_before_answer',
  'server_restart'
] as const

export type CallEndReason = (typeof CALL_END_REASONS)[number] | 'error'

// callStatusCode: "state.<trạng thái>" hay "end.<lý do>" cho thanh cuộc gọi (Libredesk ghép thành khoá
// i18n `conversation.call.<mã>`).
export function callStatusCode(state: string | null | undefined, reason?: string | null): string {
  if (state === 'ended') {
    const known = (CALL_END_REASONS as readonly string[]).includes(reason || '')
    return `end.${known ? reason : 'error'}`
  }
  return `state.${state || 'idle'}`
}

export const isCallActive = (state: string | null | undefined): boolean =>
  !['idle', 'ended'].includes(state as string)

// formatCallDuration: thời lượng "m:ss".
export function formatCallDuration(secs: number | null | undefined): string {
  const s = Math.max(0, Math.floor(secs || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// secondsSince: số giây đã qua từ một mốc RFC3339 (thời lượng trên thanh cuộc gọi).
export function secondsSince(iso: string | null | undefined, now: number = Date.now()): number {
  const t = Date.parse(iso || '')
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 1000))
}

// --- Điện thoại chi nhánh (gateway phonecalls.go) ---

/** Hội thoại vừa bấm 📞 coi là "đang quay số" tới khi điện thoại báo cuộc gọi, tối đa chừng này. */
export const DIAL_WAIT_MS = 20 * 1000

// pruneDialing: bỏ khỏi `dialing` (uuid hội thoại -> lúc bấm, ms) các mục đã quá DIAL_WAIT_MS. Sửa tại
// chỗ, để đối tượng phản ứng của giao diện (Vue reactive) được báo.
export function pruneDialing(dialing: Record<string, number>, now: number = Date.now()): void {
  for (const [uuid, at] of Object.entries(dialing)) {
    if (now - at >= DIAL_WAIT_MS) delete dialing[uuid]
  }
}

// branchCallFor: cuộc gọi của điện thoại chi nhánh thuộc hội thoại này, nếu có.
export function branchCallFor<T extends RingingCallLike>(
  list: readonly T[] | null | undefined,
  conversationUUID: string | null | undefined
): T | null {
  if (!conversationUUID) return null
  return (list || []).find((c) => c.conversation_uuid === conversationUUID) || null
}

// needsCable: điện thoại chi nhánh không nối cáp (sms-bridge báo computer_audio=false): tiếng không
// sang máy tính được, nên không bắt máy hay quay số từ hộp thư. Không rõ thì không chặn.
export const needsCable = (call: RingingCallLike | null | undefined): boolean =>
  call?.computer_audio === false

// upsample: PCM 16 kHz (WebSocket tiếng của chi nhánh) -> Float32 ở tần số của AudioContext, nội suy
// tuyến tính.
export function upsample(pcm: ArrayLike<number>, rate: number): Float32Array {
  const n = Math.round((pcm.length * rate) / 16000)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 16000) / rate
    const j = Math.floor(x)
    const f = x - j
    const a = pcm[j] || 0
    const b = pcm[Math.min(j + 1, pcm.length - 1)] || 0
    out[i] = (a + (b - a) * f) / 32768
  }
  return out
}

// --- Fanpage Web (gateway /gw/fbweb-calls, fbweb-ls) ---

export const FBWEB_CHANNEL = 'fb-bridge-web'
/** Facebook không báo khách không nghe máy: gọi đi quá chừng này thì tự cúp. */
export const OUTGOING_RING_MS = 60 * 1000
// Camera của khách: Facebook giữ track video và không mute khi khách tắt camera, nên đếm khung hình đã
// giải mã (getStats) mỗi CAMERA_POLL_MS; không có khung mới trong CAMERA_IDLE_MS thì coi là tắt.
export const CAMERA_POLL_MS = 1000
export const CAMERA_IDLE_MS = 2000

export const fbwebKey = (c: RingingCallLike): string => `${c.account}:${c.call_id}`

export function isFbwebCall(c: RingingCallLike | null | undefined): boolean {
  return c?.channel === FBWEB_CHANNEL
}

// withRing: thân yêu cầu kèm ring_id. Messenger dùng lại mã phòng (call_id) cho mọi cuộc gọi giữa khách
// và Trang; ring_id để thao tác của cuộc cũ không chạm cuộc khách gọi lại (gateway cũ không có: gửi như trước).
export function withRing<T extends object>(body: T, ringId: string | null | undefined): T & { ring_id?: string } {
  return ringId ? { ...body, ring_id: ringId } : body
}

interface StatsEntry {
  type?: string
  kind?: string
  mediaType?: string
  trackIdentifier?: string
  framesDecoded?: number
}

// decodedFrames: số khung hình video đã giải mã của track trong một báo cáo getStats (0 nếu chưa có).
export function decodedFrames(
  report: { forEach?: (fn: (s: StatsEntry) => void) => void } | null | undefined,
  trackId?: string
): number {
  let frames = 0
  report?.forEach?.((s) => {
    if (s.type !== 'inbound-rtp' || (s.kind || s.mediaType) !== 'video') return
    if (trackId && s.trackIdentifier && s.trackIdentifier !== trackId) return
    frames = Math.max(frames, s.framesDecoded || 0)
  })
  return frames
}

export interface CameraState {
  frames: number
  at: number
  on: boolean
}

// cameraState: trạng thái mới từ lần đếm trước và số khung hình hiện tại.
export function cameraState(
  prev: CameraState,
  frames: number,
  now: number,
  idleMs: number = CAMERA_IDLE_MS
): CameraState {
  if (frames > prev.frames) return { frames, at: now, on: true }
  return { frames: Math.max(frames, prev.frames), at: prev.at, on: prev.on && now - prev.at < idleMs }
}

// Tắt chuông chỉ trên trình duyệt này (không báo gateway, đồng nghiệp vẫn nghe máy được). Khoá kèm
// `since`: lời mời mới trong cùng phòng có `since` mới nên đổ chuông lại.
export const fbwebSilenceKey = (c: RingingCallLike): string => `${fbwebKey(c)}:${c.since || ''}`

// liveSilenceKeys: khoá của các cuộc Fanpage Web còn đổ chuông; khoá đã tắt chuông không còn ở đây thì quên.
export function liveSilenceKeys(list: readonly RingingCallLike[]): Set<string> {
  return new Set(list.filter((c) => isFbwebCall(c) && c.state === 'ringing').map(fbwebSilenceKey))
}

// fbwebCallGone: cuộc đang nói (khách gọi tới, khoá `key`, `ringId`) đã hết theo danh sách mới của gateway:
// không còn trong danh sách (khách đã cúp), hay còn phòng nhưng ring_id khác (khách cúp rồi gọi lại).
export function fbwebCallGone(
  list: readonly RingingCallLike[],
  key: string,
  ringId: string | null | undefined
): boolean {
  const cur = list.find((c) => fbwebKey(c) === key)
  return !cur || (!!ringId && !!cur.ring_id && cur.ring_id !== ringId)
}
