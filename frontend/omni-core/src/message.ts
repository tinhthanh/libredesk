// Quy ước nội dung tin của gateway omnichannel: tin nhóm, ghi chú chủ tài khoản, sticker, trích dẫn.
// Bản chuẩn là bản của app Vetgo (đọc cả nội dung bọc trong <p>), gộp vào đây 25/11/2026.

import type { AttachmentLike, MessageLike, PersonName } from './types'

// --- Chữ và HTML ---

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHTML(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#34': '"',
  '#39': "'",
  nbsp: ' '
}

// unescapeHTML: giải mã các entity mà escapeHTML và trình soạn của Libredesk sinh ra.
export const unescapeHTML = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|#34|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? '')

// looksLikeHtml: có thẻ HTML thật (không chỉ dấu `<`, `>` trong chữ): tên thẻ đã biết, sau đó chỉ là thuộc tính
// hợp lệ. Không nhận mọi tên thẻ: tin gõ không dấu như "Gui <ten khach> nhe" sẽ bị sanitizer xoá mất chữ.
export function looksLikeHtml(s: string | null | undefined): boolean {
  return /<\/?(p|br|div|span|a|b|strong|i|em|u|s|strike|del|ins|small|big|mark|sup|sub|font|center|blockquote|q|cite|ul|ol|li|dl|dt|dd|img|figure|figcaption|pre|code|h[1-6]|table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col|hr|section|article|header|footer|html|body|head|meta|style|title|label|abbr|address|wbr)(\s+[a-z_:][a-z0-9_.:-]*(\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/i.test(
    s || ''
  )
}

// htmlToText: HTML -> một dòng chữ. Chữ thuần (không có thẻ thật) giữ nguyên "<…>" của người gõ ("giá <100k và
// >50k"); chỉ HTML thật mới bỏ thẻ. Giải mã entity, `&amp;` sau cùng.
export const htmlToText = (html: string | null | undefined): string =>
  (looksLikeHtml(html) ? (html || '').replace(/<[^>]*>/g, ' ') : html || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

// previewText: nội dung tin -> dòng xem trước, bỏ khối trích dẫn ở đầu.
export const previewText = (html: string | null | undefined): string =>
  htmlToText((html || '').replace(/^\s*<blockquote[\s\S]*?<\/blockquote>/, ''))

// --- Tên ---

export const fullName = (p: PersonName | null | undefined): string =>
  [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim()

// cleanName: bỏ "👥" đầu tên nhóm và hậu tố " · Zalo acc2" gateway thêm để phân biệt tài khoản.
export const cleanName = (name: string): string =>
  name
    .replace(/^👥\s*/, '')
    .replace(/\s+·\s.*$/, '')
    .trim()

// displayName: tên hiển thị của khách hay nhóm (kênh và tài khoản đã có ở logo, tên hộp thư).
export const displayName = (p: PersonName | null | undefined): string => cleanName(fullName(p))

// --- Tin nhóm ---
// Nhóm Zalo/Facebook vào Libredesk qua một khách cho mỗi nhóm (tên "👥 …"), mỗi tin khách có tiền tố
// "[Người gửi]: ", có thể nằm trong <p> đầu tiên khi nội dung là HTML.
const SENDER_PREFIX = /^(\s*<p>)?\[([^\]\n]{1,128})\]: ?/

export const isGroupContact = (author: PersonName | null | undefined): boolean =>
  (author?.first_name || '').startsWith('👥')

// groupSender: tên thành viên gửi tin nhóm, '' với tin khác.
export function groupSender(message: MessageLike | null | undefined): string {
  if (!message || message.type !== 'incoming' || !isGroupContact(message.author)) return ''
  return SENDER_PREFIX.exec(message.content || '')?.[2]?.trim() ?? ''
}

// stripGroupSender: bỏ tiền tố "[Người gửi]: " (tên đã hiện riêng), giữ <p> mở đầu nếu có.
export function stripGroupSender(content: string | null | undefined): string {
  return (content || '').replace(SENDER_PREFIX, (_m, p: string | undefined) => p ?? '')
}

// ownContent: nội dung bỏ tiền tố người gửi, chỉ với tin khách trong nhóm. Tin 1-1 và tin nhân viên giữ nguyên:
// "[Lưu ý]: mang sổ tiêm" không mất chữ.
export const ownContent = (message: MessageLike): string =>
  message.type === 'incoming' && isGroupContact(message.author)
    ? stripGroupSender(message.content)
    : message.content || ''

// --- Ghi chú chủ tài khoản ---
// Tin chủ tài khoản gửi từ điện thoại hay app khác vào Libredesk thành ghi chú, gateway mở đầu bằng
// "<p><strong>👤 Chủ tài khoản trả lời trực tiếp (…)</strong> · Người gửi</p>" (gateway/events.go, canary
// cũng khớp chuỗi này). Giao diện hiện một nhãn nhỏ thay cho dòng đó.
const OWNER_HEADING =
  /^\s*<p><strong>👤 Chủ tài khoản trả lời trực tiếp[^<]*<\/strong>(?: · ([^<]*))?<\/p>/
const OWNER_PREVIEW = /^👤 Chủ tài khoản trả lời trực tiếp \([^)]*\)\.?(?: · Chủ tài khoản)?\s*/
// Nhãn tệp đứng một mình ("🖼️ Ảnh", "📎 bao-gia.pdf", "🎬 Video · 0:11") lặp lại tệp hiện bên dưới.
const MEDIA_LABEL = /^\s*<p>(?:🖼️|📎|🎬|🎤|🧩|✏️)[^<]*<\/p>\s*$/

export interface OwnerReply {
  /** Người gửi ('' khi gateway chỉ ghi "Chủ tài khoản", tránh lặp với nhãn). */
  sender: string
  body: string
}

// ownerReply: {sender, body} của ghi chú chủ tài khoản, null với tin khác. `hasFiles`: tin có tệp thì bỏ nhãn tệp
// đứng một mình trong body.
export function ownerReply(content: string | null | undefined, hasFiles?: boolean): OwnerReply | null {
  const text = content || ''
  const match = OWNER_HEADING.exec(text)
  if (!match) return null
  let body = text.slice(match[0].length)
  if (hasFiles && MEDIA_LABEL.test(body)) body = ''
  const sender = unescapeHTML(match[1] || '').trim()
  return { sender: sender === 'Chủ tài khoản' ? '' : sender, body }
}

// ownerPreview: dòng xem trước của danh sách bỏ tiêu đề ghi chú chủ tài khoản; null khi tin cuối không phải.
export function ownerPreview(text: string | null | undefined): string | null {
  const value = text || ''
  const match = OWNER_PREVIEW.exec(value)
  return match ? value.slice(match[0].length) : null
}

// --- Sticker ---
// Sticker là ảnh bot đặt tên "sticker.webp", "sticker-2.png" hay "sticker-<id>.webp" (Zalo), mọi kênh.
const STICKER_NAME = /^sticker(?:[-.]|$)/i

export function isSticker(attachment: AttachmentLike | null | undefined): boolean {
  return (
    (attachment?.content_type || '').startsWith('image/') && STICKER_NAME.test(attachment?.name || '')
  )
}

// imagePreviewSrc: bong bóng dùng ảnh thu nhỏ của server, nhưng ảnh thu nhỏ là PNG tĩnh, nên GIF động
// dùng tệp gốc để còn chạy.
export function imagePreviewSrc(
  attachment: AttachmentLike | null | undefined,
  thumbFor: (url: string | null | undefined) => string
): string {
  if ((attachment?.content_type || '').toLowerCase() === 'image/gif') return attachment?.url || ''
  return attachment?.thumbnail_url || thumbFor(attachment?.url)
}

// isStickerOnly: một sticker không kèm chữ thì vẽ không khung, như Messenger và Zalo.
export function isStickerOnly(
  content: string | null | undefined,
  attachments: readonly AttachmentLike[] | null | undefined
): boolean {
  const files = (attachments || []).filter((a) => a.disposition !== 'inline')
  if (files.length !== 1 || !isSticker(files[0])) return false
  const text = stripGroupSender(content || '')
    .replace(/<(?!img\b)[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  return text === ''
}

// --- Trả lời trích dẫn ---
// Nhân viên chọn một tin của khách, ô soạn gửi kèm <blockquote data-reply-uuid="…"> ở đầu; gateway đổi
// tin Libredesk đó thành tin Zalo/Facebook và gửi trả lời trích dẫn của nền tảng.

/** Đích trả lời: tin được trích, tác giả và một dòng chữ của tin. */
export interface ReplyTarget {
  uuid: string
  author: string
  text: string
}

export interface QuotedReply {
  author: string
  text: string
  /** Phần còn lại của tin (HTML). */
  body: string
}

const QUOTE_TEXT_MAX = 120
const QUOTE_AUTHOR_MAX = 60
/** Chữ của đích trả lời khi tin chỉ có tệp. */
export const QUOTE_FILE_ONLY = '[Tệp đính kèm]'

const REPLY_QUOTE = /^\s*<blockquote data-reply-uuid="[^"]*">([\s\S]*?)<\/blockquote>/
// Gateway viết dòng đầu tin khách trả lời: "↪ «Tác giả: nội dung»" (có thể nằm trong <p>, sau đó xuống dòng
// hay <br>).
const CUSTOMER_QUOTE = /^(\s*<p>)?↪ «([\s\S]*?)»(?:\n|<br\s*\/?>)?/

// splitQuoted đọc "Tác giả: nội dung" (bot và quoteHTML đều viết dạng này).
function splitQuoted(line: string, body: string): QuotedReply {
  const sep = line.indexOf(': ')
  const named = sep > 0 && sep <= QUOTE_AUTHOR_MAX
  return { author: named ? line.slice(0, sep) : '', text: named ? line.slice(sep + 2) : line, body }
}

// replyQuote: tin nhân viên mở đầu bằng trích dẫn (quoteHTML) -> {author, text, body}; null khi không có.
export function replyQuote(content: string | null | undefined): QuotedReply | null {
  const text = content || ''
  const match = REPLY_QUOTE.exec(text)
  if (!match) return null
  const line = unescapeHTML((match[1] ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
  return splitQuoted(line, text.slice(match[0].length))
}

// customerQuote: tin khách trả lời một tin khác (đã bỏ tiền tố người gửi nhóm) -> {author, text, body}; body giữ
// <p> mở đầu nếu có. null khi không có trích dẫn.
export function customerQuote(content: string | null | undefined): QuotedReply | null {
  const text = content || ''
  const match = CUSTOMER_QUOTE.exec(text)
  if (!match) return null
  return splitQuoted((match[2] ?? '').trim(), (match[1] ?? '') + text.slice(match[0].length))
}

// quotePreview: dòng xem trước của danh sách bỏ tin được trích: "[Nhất]: ↩ trả lời".
export function quotePreview(text: string | null | undefined): string {
  return (text || '').replace(/^(\[[^\]]+\]: )?↪ «[\s\S]*?»\s*/, '$1↩ ')
}

// quoteText: một dòng chữ của nội dung (bỏ trích dẫn của chính nó), tối đa QUOTE_TEXT_MAX ký tự.
export function quoteText(content: string | null | undefined): string {
  const own = content || ''
  const text = htmlToText(customerQuote(own)?.body ?? own)
  return text.length > QUOTE_TEXT_MAX ? text.slice(0, QUOTE_TEXT_MAX - 1) + '…' : text
}

// quoteTarget: đích trả lời cho một tin của khách.
export function quoteTarget(message: MessageLike): ReplyTarget {
  return {
    uuid: message.uuid || '',
    author: groupSender(message) || displayName(message.author),
    text: quoteText(ownContent(message)) || QUOTE_FILE_ONLY
  }
}

// quoteHTML: khối trích dẫn đặt trước câu trả lời; gateway đọc data-reply-uuid. '' khi không có đích.
export function quoteHTML(target: Partial<ReplyTarget> | null | undefined): string {
  if (!target?.uuid) return ''
  return `<blockquote data-reply-uuid="${escapeHTML(target.uuid)}"><p>${escapeHTML(target.author ?? '')}: ${escapeHTML(target.text ?? '')}</p></blockquote>`
}
