// Đọc các quy ước nội dung của gateway omnichannel (README "Quy ước hội thoại", TESTING.md "Ma trận phạm vi",
// gateway/events.go) để vẽ đúng từng loại tin thay vì hiện chuỗi emoji thô: dòng xem trước, ghi chú sự kiện, tin có
// cấu trúc. Bản của app Vetgo, gộp vào đây 25/11/2026. Hàm trả loại (`kind`); icon và chữ nút do giao diện chọn.

import { looksLikeHtml, ownContent, ownerPreview, stripGroupSender, unescapeHTML } from './message'
import type { AttachmentLike, MessageLike } from './types'

// contentLines: HTML (hay chữ thuần) -> các dòng chữ, giữ xuống dòng của <br> và <p>. Chữ thuần không bị xoá "<…>"
// của người gõ: chỉ HTML thật mới bỏ thẻ.
export const contentLines = (content: string | null | undefined): string[] =>
  (!looksLikeHtml(content)
    ? unescapeHTML(content || '')
    : unescapeHTML(
        (content || '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
          .replace(/<[^>]*>/g, '')
      )
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

// --- Dòng xem trước của danh sách hội thoại ---

export type PreviewKind =
  | 'owner'
  | 'quote'
  | 'sticker'
  | 'image'
  | 'file'
  | 'video'
  | 'audio'
  | 'call'
  | 'link'
  | 'contact'
  | 'poll'
  | 'location'
  | 'todo'
  | 'friend'
  | 'alert'

export interface PreviewParts {
  /** Loại tin để giao diện vẽ icon; null là tin chữ thường. */
  kind: PreviewKind | null
  /** Chữ đã bỏ emoji, tiêu đề. */
  text: string
}

// Nhãn gateway ghi cho tin chỉ có tệp ("🧩 Sticker", "🖼️ Ảnh", "📎 tên-file", "📞 Cuộc gọi…") và các tin có cấu trúc.
const PREVIEW_KINDS: ReadonlyArray<readonly [RegExp, PreviewKind]> = [
  [/^🧩\s*/u, 'sticker'],
  [/^🖼️?\s*/u, 'image'],
  [/^📎\s*/u, 'file'],
  [/^(📹|🎬)\s*/u, 'video'],
  [/^🎤\s*/u, 'audio'],
  [/^📞\s*/u, 'call'],
  [/^🔗\s*/u, 'link'],
  [/^👤\s*/u, 'contact'],
  [/^📊\s*/u, 'poll'],
  [/^📍\s*/u, 'location'],
  [/^✅\s*/u, 'todo'],
  [/^🤝\s*/u, 'friend'],
  [/^⚠️?\s*/u, 'alert']
]

// previewParts: dòng xem trước (đã bỏ tiền tố người gửi nhóm) -> loại và chữ. Ghi chú chủ tài khoản bỏ tiêu đề; khách
// trả lời trích dẫn "↪ «Tác giả: nội dung» trả lời" chỉ giữ phần trả lời.
export function previewParts(text: string | null | undefined): PreviewParts {
  const value = text || ''
  const owner = ownerPreview(value)
  if (owner !== null) return { kind: 'owner', text: owner }
  const quoted = /^↪ «[\s\S]*?»\s*/.exec(value)
  if (quoted) return { kind: 'quote', text: value.slice(quoted[0].length) }
  for (const [re, kind] of PREVIEW_KINDS) {
    if (re.test(value)) return { kind, text: value.replace(re, '') }
  }
  return { kind: null, text: value }
}

// --- Nhãn tệp gateway thêm khi tin không có chú thích ---

const LABEL = /^(🖼️? Ảnh|🧩 Sticker|🎬 Video(?: · \d+:\d{2})?|🎤 Ghi âm|📎 .+)$/u

// isAttachmentLabelOnly: chữ của tin chỉ gồm các nhãn tệp ("🖼️ Ảnh, 📎 bao-gia.pdf"), ẩn được vì tệp đã hiện bên dưới.
export function isAttachmentLabelOnly(
  content: string | null | undefined,
  attachments: readonly AttachmentLike[] | null | undefined
): boolean {
  if (!attachments?.length) return false
  const text = contentLines(stripGroupSender(content)).join(' ').trim()
  return !!text && text.split(/,\s*/).every((part) => LABEL.test(part.trim()))
}

// videoDuration: thời lượng video gateway ghi ("🎬 Video · 0:05"), '' nếu không có.
export const videoDuration = (content: string | null | undefined): string =>
  /🎬 Video · (\d+:\d{2})/u.exec(content || '')?.[1] ?? ''

// --- Ghi chú sự kiện (gateway `eventTitles`, callNote, ghi chú gửi lỗi) ---

export type EventNoteKind = 'recall' | 'edit' | 'reaction' | 'group' | 'friend' | 'system' | 'call' | 'failed'

export interface EventNote {
  kind: EventNoteKind
  /** Tiêu đề đã bỏ emoji đầu. */
  title: string
  /** Người liên quan (`noteHTML(title, sender, …)`). */
  sender: string
  /** Các dòng chi tiết. */
  body: string[]
  /** Cuộc gọi nhỡ hay không thành. */
  missed: boolean
}

const EVENT_PREFIX: ReadonlyArray<readonly [string, EventNoteKind]> = [
  ['↩️', 'recall'],
  ['✏️', 'edit'],
  ['💬', 'reaction'],
  ['👥', 'group'],
  ['🤝', 'friend'],
  ['ℹ️', 'system'],
  ['📞', 'call'],
  ['⚠️', 'failed']
]
const NOTE_HEAD = /^\s*<p><strong>([\s\S]*?)<\/strong>(?:\s*·\s*([^<]*))?<\/p>/
const MISSED = /nhỡ|không nghe|từ chối|đang bận|hủy|huỷ|kết thúc trước|không được/i

// Dấu `meta.omni_event` gateway gắn cho ghi chú của nó -> loại sự kiện (`owner_message` là tin thật: không phải).
const MARKER_KIND: Readonly<Record<string, EventNoteKind>> = {
  call: 'call',
  failed: 'failed',
  recall: 'recall',
  edit: 'edit',
  reaction: 'reaction',
  group_event: 'group',
  friend_event: 'friend',
  system: 'system'
}

/**
 * Gateway gắn dấu `meta.omni_event` cho ghi chú của nó từ omnichannel#159, libredesk#20 (ghi chú đầu tiên có dấu lúc
 * 10:53Z). Ghi chú tạo sau mốc mà không có dấu là nhân viên tự viết, luôn là ghi chú thường kể cả khi bắt đầu bằng 📞
 * hay ⚠️. Ghi chú trước mốc chưa ai có dấu: vẫn đoán theo emoji đầu dòng.
 */
export const OMNI_EVENT_SINCE = Date.parse('2026-11-22T11:00:00Z')

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export interface EventNoteOptions {
  /**
   * Đã thấy ít nhất một ghi chú có dấu `omni_event` (gateway đang chạy là bản mới). Mỗi phòng khám có gateway riêng,
   * nâng cấp có thể muộn hơn mốc: chưa thấy dấu nào thì vẫn đoán theo emoji.
   */
  markersSeen?: boolean
}

// eventNote: ghi chú nội bộ do gateway tạo cho một sự kiện; null với ghi chú nhân viên tự viết. Có dấu
// `meta.omni_event` thì theo dấu; không dấu thì chỉ đoán theo emoji với ghi chú cũ (trước OMNI_EVENT_SINCE) hay khi
// chưa thấy dấu nào.
export function eventNote(message: MessageLike, { markersSeen = false }: EventNoteOptions = {}): EventNote | null {
  if (!message.private) return null
  const content = message.content || ''
  const marker = message.meta?.['omni_event']
  const marked = typeof marker === 'string' ? marker : ''
  if (marked === 'owner_message') return null
  if (!marked && markersSeen && Date.parse(message.created_at || '') >= OMNI_EVENT_SINCE) return null
  const head = NOTE_HEAD.exec(content)
  const title = unescapeHTML(head ? (head[1] ?? '') : (contentLines(content)[0] ?? ''))
  const byEmoji = EVENT_PREFIX.find(([p]) => title.startsWith(p) || title.startsWith(p.replace('️', '')))
  const markedKind = hasOwn(MARKER_KIND, marked) ? MARKER_KIND[marked] : undefined
  const kind = markedKind ?? byEmoji?.[1]
  if (!kind) return null
  const prefix = byEmoji?.[0] ?? ''
  const rest = head ? contentLines(content.slice(head[0].length)) : contentLines(content).slice(1)
  let clean = (prefix ? title.replace(prefix, '').replace(prefix.replace('️', ''), '') : title).trim()
  let body = rest
  // "📞 Cuộc gọi" + dòng "Gọi khách · 0:07 (…)": dòng chi tiết mới là nội dung chính.
  if (kind === 'call' && /^Cuộc gọi$/i.test(clean) && body.length) {
    clean = body[0] ?? ''
    body = body.slice(1)
  }
  // Ghi chú có tệp: bỏ nhãn tệp thừa ("🖼️ Ảnh").
  if (message.attachments?.length) body = body.filter((l) => !LABEL.test(l))
  const missed = kind === 'call' && MISSED.test(clean)
  return { kind, title: clean, sender: unescapeHTML(head?.[2]?.trim() ?? ''), body, missed }
}

// --- Tin có cấu trúc (bot đổi thành chữ có emoji đầu dòng) ---

export type RichKind =
  | 'link'
  | 'contact'
  | 'poll'
  | 'location'
  | 'todo'
  | 'call'
  | 'friend'
  | 'video'
  | 'undecryptable'

export interface RichCard {
  kind: RichKind
  title: string
  lines: string[]
  url: string | null
  /** Bình chọn: người tạo ('' nếu không rõ). */
  pollCreator: string
  /** Cuộc gọi nhỡ hay không thành. */
  missed: boolean
}

const RICH_PREFIX: ReadonlyArray<readonly [RegExp, RichKind]> = [
  [/^🔗\s*/u, 'link'],
  [/^👤\s*/u, 'contact'],
  [/^📊\s*/u, 'poll'],
  [/^📍\s*/u, 'location'],
  [/^✅\s*/u, 'todo'],
  [/^📞\s*/u, 'call'],
  [/^🤝\s*/u, 'friend'],
  // Video quá lớn bot gửi dạng link: "🎬 ten.mp4 · 0:48 · 11.2 MB — xem & ghi chú review: URL · …".
  [/^🎬\s*/u, 'video'],
  [/^⚠️?\s*Tin nhắn mã hóa/u, 'undecryptable']
]
const URL_RE = /https?:\/\/\S+/

// richCard: tin có cấu trúc (link, danh thiếp, bình chọn, vị trí, việc cần làm, cuộc gọi, lời mời kết bạn, video lớn,
// tin mã hoá không giải được); null với tin khác.
export function richCard(message: MessageLike): RichCard | null {
  if (message.private || message.type === 'activity') return null
  // "🎬 Video · 0:05" kèm tệp video là nhãn, không phải thẻ link.
  if (message.attachments?.length && /^(\s*<p>)?(\[[^\]]+\]: )?🎬 Video\b/u.test(message.content || '')) return null
  const lines = contentLines(ownContent(message))
  const first = lines[0] ?? ''
  const hit = RICH_PREFIX.find(([re]) => re.test(first))
  if (!hit) return null
  const [re, kind] = hit
  const title = kind === 'undecryptable' ? first.replace(/^⚠️?\s*/u, '') : first.replace(re, '')
  // URL có thể nằm cuối dòng tiêu đề ("📍 Vị trí https://…") hay ở dòng riêng.
  const all = [title, ...lines.slice(1)]
  const url = all.map((l) => URL_RE.exec(l)?.[0]).find(Boolean) ?? null
  let rest = lines.slice(1).filter((l) => l !== url)
  let head = (url ? title.replace(url, '') : title).trim() || title
  let pollCreator = ''
  // Bỏ phần lặp với nhãn loại thẻ, tách người tạo.
  if (kind === 'contact') head = head.replace(/^Danh thiếp:?\s*/, '')
  if (kind === 'todo') head = head.replace(/^Việc cần làm:?\s*/, '')
  if (kind === 'video') {
    // "ten.mp4 · 0:48 · 11.2 MB — xem & ghi chú review: · Ghi chú" -> tên tệp + dòng thông tin.
    const [name, ...info] = head.split(' · ')
    head = (name ?? '').trim()
    const meta = info
      .join(' · ')
      .replace(/—[^·]*:\s*/, '')
      .replace(/\s*·\s*$/, '')
      .trim()
    if (meta) rest = [meta, ...rest]
  }
  if (kind === 'friend') head = /«([\s\S]*)»/.exec(head)?.[1]?.trim() ?? ''
  if (kind === 'location' && /^Vị trí$/i.test(head) && rest.length) {
    head = rest[0] ?? ''
    rest = rest.slice(1)
  }
  if (kind === 'poll') {
    const sep = head.indexOf(': ')
    if (sep > 0) {
      pollCreator = head.slice(0, sep)
      head = head.slice(sep + 2)
    }
    rest = rest.map((l) => l.replace(/^[•-]\s*/, ''))
  }
  const missed = kind === 'call' && MISSED.test(title)
  return { kind, title: head, lines: rest, url, pollCreator, missed }
}
