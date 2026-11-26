// Đọc các quy ước nội dung của gateway omnichannel (README "Quy ước hội thoại", TESTING.md "Ma trận phạm vi",
// gateway/events.go) để vẽ đúng từng loại tin thay vì hiện chuỗi emoji thô: dòng xem trước, ghi chú sự kiện, tin có
// cấu trúc. Bản của app Vetgo, gộp vào đây 25/11/2026. Hàm trả loại (`kind`); icon và chữ nút do giao diện chọn.

import { looksLikeHtml, ownContent, ownerPreview, stripGroupSender, unescapeHTML } from './message'
import type { AttachmentLike, ConversationListItemLike, MessageLike } from './types'

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
  | 'system'
  | 'recall'
  | 'edit'
  | 'reaction'
  | 'group'

export interface PreviewParts {
  /** Loại tin để giao diện vẽ icon; null là tin chữ thường. */
  kind: PreviewKind | null
  /** Chữ đã bỏ emoji, tiêu đề. */
  text: string
  /** Ghi chú chủ tài khoản (`kind: 'owner'`): loại của phần sau tiêu đề (vd 'image' với "🖼️ Ảnh"), không có thì null. */
  innerKind?: PreviewKind | null
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
  [/^⚠️?\s*/u, 'alert'],
  // Ghi chú sự kiện của gateway (eventTitles): thông báo, thu hồi, sửa, cảm xúc, nhóm.
  [/^ℹ️?\s*/u, 'system'],
  [/^↩️?\s*/u, 'recall'],
  [/^✏️?\s*/u, 'edit'],
  [/^💬\s*/u, 'reaction'],
  [/^👥\s*/u, 'group']
]

function labelParts(value: string): PreviewParts {
  for (const [re, kind] of PREVIEW_KINDS) {
    if (re.test(value)) return { kind, text: value.replace(re, '') }
  }
  return { kind: null, text: value }
}

// previewParts: dòng xem trước (đã bỏ tiền tố người gửi nhóm) -> loại và chữ. Ghi chú chủ tài khoản bỏ tiêu đề, phần
// sau đọc tiếp ("🖼️ Ảnh" -> innerKind 'image', chữ "Ảnh"); khách trả lời trích dẫn "↪ «Tác giả: nội dung» trả lời" chỉ
// giữ phần trả lời.
export function previewParts(text: string | null | undefined): PreviewParts {
  const value = text || ''
  const owner = ownerPreview(value)
  if (owner !== null) {
    const inner = labelParts(owner)
    return { kind: 'owner', text: inner.text, innerKind: inner.kind }
  }
  const quoted = /^↪ «[\s\S]*?»\s*/.exec(value)
  if (quoted) return { kind: 'quote', text: value.slice(quoted[0].length) }
  return labelParts(value)
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
  /**
   * Bình chọn: người và hành động, nguyên văn của bot ("Lan tạo bình chọn", "Lan bỏ phiếu", "Lan cập nhật bình
   * chọn"); '' nếu không có. Hiện như vậy, không ghép thêm chữ.
   */
  pollAction: string
  /** Bình chọn: các lựa chọn (dòng mở đầu bằng "•" hay "-", đã bỏ dấu). Các dòng khác ("Chọn: …", "Kết quả: …") ở `lines`. */
  options: string[]
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
  let pollAction = ''
  let options: string[] = []
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
    // zalo-bot: "📊 <Tên> <hành động>: <câu hỏi>" (zca-js deploy/content.mjs), rồi "Chọn: …", "Kết quả: …".
    if (sep > 0) {
      pollAction = head.slice(0, sep)
      head = head.slice(sep + 2)
    }
    const bullet = /^[•-]\s*/
    options = rest.filter((l) => bullet.test(l)).map((l) => l.replace(bullet, ''))
    rest = rest.filter((l) => !bullet.test(l))
  }
  const missed = kind === 'call' && MISSED.test(title)
  return { kind, title: head, lines: rest, url, pollAction, options, missed }
}

// --- Lời mời kết bạn Zalo: còn đồng ý được không ---

/**
 * - `open`: còn đồng ý được (hiện nút).
 * - `accepted`: đã là bạn (nhân viên đồng ý trong hộp thư, hay đồng ý trên điện thoại).
 * - `closed`: lời mời không còn hiệu lực (thu hồi, từ chối, huỷ kết bạn, chặn, hay đã có lời mời mới hơn).
 */
export type FriendRequestState = 'open' | 'accepted' | 'closed'

// Ghi chú sau thẻ lời mời cho biết đã kết bạn: gateway "🤝 Đã đồng ý lời mời kết bạn · <nhân viên>" (friend.go), thẻ
// Zalo "🤝 X đã trở thành bạn bè", tin hệ thống Zalo "ℹ️ Thông báo" "Bạn vừa kết bạn với …".
const FRIEND_ACCEPTED = /Đã đồng ý lời mời kết bạn|đã trở thành bạn bè|vừa kết bạn với/i
// zalo-bot friendEventInfo (zca-js deploy/content.mjs): thu hồi, từ chối, huỷ kết bạn, chặn. "Chủ tài khoản đã gửi lời
// mời kết bạn" và "đã bỏ chặn" không đổi trạng thái của lời mời.
const FRIEND_CLOSED = /Lời mời kết bạn (đã bị thu hồi|bị từ chối)|Đã (huỷ|hủy) kết bạn|Chủ tài khoản đã chặn/i

// friendRequestState: lời mời kết bạn `request` (thẻ richCard kind 'friend' của khách) còn đồng ý được không, theo các
// tin sau nó trong `messages` (thứ tự cũ trước, mới sau). Sự kiện cuối cùng quyết định; nút tạm của giao diện (đang gửi,
// vừa đồng ý) do giao diện giữ. Không thấy `request` trong danh sách thì coi là còn mở.
export function friendRequestState(
  messages: readonly MessageLike[],
  request: MessageLike,
  options: EventNoteOptions = {}
): FriendRequestState {
  const index = messages.findIndex((m) => m === request || (!!request.uuid && m.uuid === request.uuid))
  let state: FriendRequestState = 'open'
  if (index < 0) return state
  for (const m of messages.slice(index + 1)) {
    if (!m.private) {
      // Lời mời mới hơn của khách: thẻ cũ không còn là lời mời đang chờ.
      if (m.type === 'incoming' && richCard(m)?.kind === 'friend') return 'closed'
      continue
    }
    const note = eventNote(m, options)
    if (!note || (note.kind !== 'friend' && note.kind !== 'system')) continue
    const text = [note.title, ...note.body].join(' ')
    if (FRIEND_ACCEPTED.test(text)) state = 'accepted'
    else if (FRIEND_CLOSED.test(text)) state = 'closed'
  }
  return state
}

// --- Tin cuối trong danh sách hội thoại ---

// Tin hoạt động Libredesk ghi sẵn bằng tiếng Anh (internal/conversation/message.go, getMessageActivityContent),
// vd "System  marked the conversation as Resolved". Libredesk tính chúng là tin của agent.
const ACTIVITY_PATTERNS: readonly RegExp[] = [
  /^(.+?) marked the conversation as (.+)$/,
  /^Assigned to (.+) team by (.+)$/,
  /^Assigned to (.+) by (.+)$/,
  /^(.+?) self-assigned this conversation$/,
  /^(.+?) set priority to (.+)$/,
  /^(.+?) added tag (.+)$/,
  /^(.+?) removed tag (.+)$/,
  /^(.+?) set (.+) SLA policy$/,
  /^(.+) joined the conversation$/
]

// isActivityText: dòng xem trước là tin hoạt động của Libredesk.
export function isActivityText(text: string | null | undefined): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  return ACTIVITY_PATTERNS.some((re) => re.test(t))
}

// Ghi chú của gateway mở đầu bằng một trong các emoji này (eventTitles, callNote, ghi chú chủ tài khoản).
const NOTE_START = /^(📞|↩️|✏️|💬|👥|🤝|ℹ️|⚠️|👤)/u

// lastMessageByStaff: tin cuối của hội thoại là tin nhân viên viết. Libredesk tính cả ghi chú của gateway (cuộc
// gọi, thu hồi, chủ tài khoản trả lời...) và tin hoạt động là của agent. Có dấu `omni_event` là ghi chú của gateway;
// không dấu thì chỉ đoán theo emoji với tin trước OMNI_EVENT_SINCE (khi chưa có dấu) hay server cũ không có trường.
export function lastMessageByStaff(item: ConversationListItemLike | null | undefined): boolean {
  if (item?.last_message_sender !== 'agent') return false
  const text = item.last_message || ''
  if (isActivityText(text)) return false
  if ('last_message_omni_event' in item) {
    if (item.last_message_omni_event) return false
    const at = Date.parse(item.last_message_at || '')
    return !(NOTE_START.test(text) && !(at >= OMNI_EVENT_SINCE))
  }
  return !NOTE_START.test(text)
}
