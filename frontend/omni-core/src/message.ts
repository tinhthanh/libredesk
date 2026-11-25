// Quy ước nội dung tin của gateway omnichannel: tin nhóm, ghi chú chủ tài khoản, sticker, trích dẫn.

import type { AttachmentLike, MessageLike, PersonName } from './types'

// Nhóm Zalo/Facebook vào Libredesk qua một khách cho mỗi nhóm (tên "👥 …"), mỗi tin có tiền tố
// "[Người gửi]: ". Các hàm dưới tách lại người gửi để giao diện hiện tên và avatar.
const SENDER_PREFIX = /^\[([^\]\n]{1,128})\]: ?/

export const isGroupContact = (author: PersonName | null | undefined): boolean =>
  (author?.first_name || '').startsWith('👥')

// groupSender: tên thành viên của tin nhóm, '' với tin khác.
export function groupSender(message: MessageLike | null | undefined): string {
  if (!message || message.type !== 'incoming' || !isGroupContact(message.author)) return ''
  const match = SENDER_PREFIX.exec(message.content || '')
  return match ? (match[1] ?? '').trim() : ''
}

// stripGroupSender: bỏ tiền tố "[Người gửi]: " (tên đã hiện riêng).
export function stripGroupSender(content: string | null | undefined): string {
  return (content || '').replace(SENDER_PREFIX, '')
}

// Tin chủ tài khoản gửi từ điện thoại hay app khác vào Libredesk thành ghi chú, gateway mở đầu bằng
// "<p><strong>👤 Chủ tài khoản trả lời trực tiếp (…)</strong> · Người gửi</p>" (gateway/events.go,
// canary cũng khớp chuỗi này). Giao diện hiện một nhãn nhỏ thay cho dòng đó.
const OWNER_HEADING =
  /^\s*<p><strong>👤 Chủ tài khoản trả lời trực tiếp[^<]*<\/strong>(?: · ([^<]*))?<\/p>/
const OWNER_PREVIEW = /^👤 Chủ tài khoản trả lời trực tiếp \([^)]*\)\.?(?: · Chủ tài khoản)?\s*/
// Nhãn tệp đứng một mình ("🖼️ Ảnh", "📎 bao-gia.pdf", "🎬 Video · 0:11") lặp lại tệp hiện bên dưới.
const MEDIA_LABEL = /^\s*<p>(?:🖼️|📎|🎬|🎤|🧩|✏️)[^<]*<\/p>\s*$/

const HTML_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  '#34': '"',
  '#39': "'",
  amp: '&'
}

export const unescapeHTML = (s: string): string =>
  s.replace(/&(lt|gt|quot|#34|#39|amp);/g, (_, e: string) => HTML_ENTITIES[e] ?? '')

export function escapeHTML(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

export interface OwnerReply {
  sender: string
  body: string
}

// ownerReply: {sender, body} của ghi chú chủ tài khoản, null với tin khác.
export function ownerReply(content: string | null | undefined, hasFiles?: boolean): OwnerReply | null {
  const text = content || ''
  const match = OWNER_HEADING.exec(text)
  if (!match) return null
  let body = text.slice(match[0].length)
  if (hasFiles && MEDIA_LABEL.test(body)) body = ''
  return { sender: unescapeHTML(match[1] || '').trim(), body }
}

// ownerPreview: dòng xem trước của danh sách bỏ tiêu đề ghi chú chủ tài khoản; null khi tin cuối không phải.
export function ownerPreview(text: string | null | undefined): string | null {
  const value = text || ''
  const match = OWNER_PREVIEW.exec(value)
  return match ? value.slice(match[0].length) : null
}

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

export interface ReplyTarget {
  conversationUUID: string
  uuid: string
  author: string
  text: string
}

export interface QuotedReply {
  author: string
  text: string
  body: string
}

const QUOTE_TEXT_MAX = 120
const QUOTE_AUTHOR_MAX = 60

// quoteText: một dòng chữ thuần cho phần xem trước của trích dẫn.
export function quoteText(content: string | null | undefined): string {
  const own = stripGroupSender(content || '')
  const text = (customerQuote(own)?.body ?? own)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > QUOTE_TEXT_MAX ? text.slice(0, QUOTE_TEXT_MAX - 1) + '…' : text
}

// quoteTarget: đích trả lời cho một tin của khách.
export function quoteTarget(conversationUUID: string, message: MessageLike): ReplyTarget {
  return {
    conversationUUID,
    uuid: message.uuid || '',
    author:
      groupSender(message) ||
      [message.author?.first_name, message.author?.last_name]
        .filter(Boolean)
        .join(' ')
        .replace(/ ·.*$/, ''),
    text: quoteText(message.content) || '📎'
  }
}

// quoteHTML: đặt trước câu trả lời; gateway đọc data-reply-uuid.
export function quoteHTML(target: Partial<ReplyTarget> | null | undefined): string {
  if (!target?.uuid) return ''
  return `<blockquote data-reply-uuid="${escapeHTML(target.uuid)}"><p>${escapeHTML(target.author)}: ${escapeHTML(target.text)}</p></blockquote>`
}

// Trích dẫn ở đầu tin nhân viên (quoteHTML), hiện như Messenger: "đã trả lời <tác giả>" trên một bong
// bóng mờ, câu trả lời ở bong bóng riêng.
const REPLY_QUOTE = /^\s*<blockquote data-reply-uuid="[^"]*">([\s\S]*?)<\/blockquote>/

// splitQuoted đọc "Tác giả: nội dung" (bot và quoteHTML đều viết dạng này).
function splitQuoted(line: string, body: string): QuotedReply {
  const sep = line.indexOf(': ')
  const named = sep > 0 && sep <= QUOTE_AUTHOR_MAX
  return { author: named ? line.slice(0, sep) : '', text: named ? line.slice(sep + 2) : line, body }
}

// replyQuote: tách tin nhân viên thành {author, text, body}; null khi không có trích dẫn.
export function replyQuote(content: string | null | undefined): QuotedReply | null {
  const text = content || ''
  const match = REPLY_QUOTE.exec(text)
  if (!match) return null
  const line = unescapeHTML((match[1] ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
  return splitQuoted(line, text.slice(match[0].length))
}

// Khách trả lời trích dẫn một tin: gateway viết "↪ «Tác giả: nội dung»" ở dòng đầu (đã bỏ tiền tố người
// gửi của nhóm).
const CUSTOMER_QUOTE = /^↪ «([\s\S]*?)»\n/

// customerQuote: tách tin khách thành {author, text, body}; null khi không có trích dẫn.
export function customerQuote(content: string | null | undefined): QuotedReply | null {
  const text = content || ''
  const match = CUSTOMER_QUOTE.exec(text)
  if (!match) return null
  return splitQuoted((match[1] ?? '').trim(), text.slice(match[0].length))
}

// quotePreview: dòng xem trước của danh sách bỏ tin được trích: "[Nhất]: ↩ trả lời".
export function quotePreview(text: string | null | undefined): string {
  return (text || '').replace(/^(\[[^\]]+\]: )?↪ «[\s\S]*?»\s*/, '$1↩ ')
}
