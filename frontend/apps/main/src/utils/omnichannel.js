import { ref } from 'vue'

// omnichannel: group chats from Zalo/Facebook arrive through one contact per
// group (named "👥 …"), each message prefixed with "[Sender]: ". These helpers
// recover the real sender so the UI can show their name and avatar.
const SENDER_PREFIX = /^\[([^\]\n]{1,128})\]: ?/

const isGroupContact = (author) => (author?.first_name || '').startsWith('👥')

// groupSender returns the member name of a group message, or '' otherwise.
export function groupSender(message) {
  if (!message || message.type !== 'incoming' || !isGroupContact(message.author)) return ''
  const match = SENDER_PREFIX.exec(message.content || '')
  return match ? match[1].trim() : ''
}

// stripGroupSender removes the "[Sender]: " prefix shown separately as a name.
export function stripGroupSender(content) {
  return (content || '').replace(SENDER_PREFIX, '')
}

// senderAvatarURL is served by the omnichannel gateway (proxied on /gw/).
export function senderAvatarURL(conversationUUID, name) {
  if (!conversationUUID || !name) return ''
  return `/gw/avatar?conv=${encodeURIComponent(conversationUUID)}&name=${encodeURIComponent(name)}`
}

// isOmnichannelInbox: inboxes the gateway creates are named "Zalo - acc" /
// "Facebook - acc" / "Fanpage - page" / "Zalo OA - oa" / "Fanpage Web - page".
export function isOmnichannelInbox(conversation) {
  return /^(Zalo|Facebook|Fanpage|Zalo OA|Fanpage Web) - /.test(conversation?.inbox_name || '')
}

// omniChannel names the channel of a gateway inbox ('' for any other inbox).
// "Zalo OA" and "Fanpage Web" are checked before their shorter prefixes.
const OMNI_CHANNEL_PREFIXES = [
  ['Zalo OA - ', 'zalo-oa'],
  ['Zalo - ', 'zalo'],
  ['Fanpage Web - ', 'fanpage-web'],
  ['Fanpage - ', 'fanpage'],
  ['Facebook - ', 'facebook']
]

export function omniChannel(conversation) {
  const name = conversation?.inbox_name || ''
  const hit = OMNI_CHANNEL_PREFIXES.find(([prefix]) => name.startsWith(prefix))
  return hit ? hit[1] : ''
}

// Replies the account owner sends from the phone or another app reach Libredesk
// as a note the gateway heads "<p><strong>👤 Chủ tài khoản trả lời trực tiếp
// (…)</strong> · Sender</p>" (gateway/events.go, also matched by the canary).
// The UI shows a small chip in place of that heading.
const OWNER_HEADING = /^\s*<p><strong>👤 Chủ tài khoản trả lời trực tiếp[^<]*<\/strong>(?: · ([^<]*))?<\/p>/
const OWNER_PREVIEW = /^👤 Chủ tài khoản trả lời trực tiếp \([^)]*\)\.?(?: · Chủ tài khoản)?\s*/
// A lone media label ("🖼️ Ảnh", "📎 bao-gia.pdf", "🎬 Video · 0:11") repeats the file shown below it.
const MEDIA_LABEL = /^\s*<p>(?:🖼️|📎|🎬|🎤|🧩|✏️)[^<]*<\/p>\s*$/

const unescapeHTML = (s) =>
  s.replace(/&(lt|gt|quot|#34|#39|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', '#34': '"', '#39': "'", amp: '&' })[e])

// ownerReply returns {sender, body} for an owner reply note, or null.
export function ownerReply(content, hasFiles) {
  const match = OWNER_HEADING.exec(content || '')
  if (!match) return null
  let body = content.slice(match[0].length)
  if (hasFiles && MEDIA_LABEL.test(body)) body = ''
  return { sender: unescapeHTML(match[1] || '').trim(), body }
}

// ownerPreview strips the heading from a conversation's last-message preview;
// null when the last message is not an owner reply.
export function ownerPreview(text) {
  const match = OWNER_PREVIEW.exec(text || '')
  return match ? text.slice(match[0].length) : null
}

// Stickers arrive as an image the bots name "sticker.webp", "sticker-2.png" or
// "sticker-<id>.webp" (Zalo), whatever the channel.
const STICKER_NAME = /^sticker(?:[-.]|$)/i

export function isSticker(attachment) {
  return (attachment?.content_type || '').startsWith('image/') && STICKER_NAME.test(attachment?.name || '')
}

// isStickerOnly: a lone sticker without text is drawn bare, like Messenger and Zalo do.
export function isStickerOnly(content, attachments) {
  const files = (attachments || []).filter((a) => a.disposition !== 'inline')
  if (files.length !== 1 || !isSticker(files[0])) return false
  const text = stripGroupSender(content || '')
    .replace(/<(?!img\b)[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  return text === ''
}

// Quote replies: the agent picks a customer message, the reply box sends it as a
// leading <blockquote data-reply-uuid="…">; the gateway maps that Libredesk
// message to the Zalo/Facebook message and sends a native quoted reply.
// One target at a time, tied to its conversation.

export const replyTarget = ref(null) // { conversationUUID, uuid, author, text }

const QUOTE_TEXT_MAX = 120

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

// quoteText: one line of plain text for the quote preview.
export function quoteText(content) {
  const text = stripGroupSender(content || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > QUOTE_TEXT_MAX ? text.slice(0, QUOTE_TEXT_MAX - 1) + '…' : text
}

// quoteTarget builds the reply target for an incoming message.
export function quoteTarget(conversationUUID, message) {
  return {
    conversationUUID,
    uuid: message.uuid,
    author: groupSender(message) || [message.author?.first_name, message.author?.last_name].filter(Boolean).join(' ').replace(/ ·.*$/, ''),
    text: quoteText(message.content) || '📎'
  }
}

// quoteHTML is prepended to the reply; the gateway reads data-reply-uuid.
export function quoteHTML(target) {
  if (!target?.uuid) return ''
  return `<blockquote data-reply-uuid="${escapeHTML(target.uuid)}"><p>${escapeHTML(target.author)}: ${escapeHTML(target.text)}</p></blockquote>`
}

// The quote an agent reply starts with (quoteHTML), shown like Messenger:
// "replied to <author>" above a muted bubble, the reply in its own bubble.
const REPLY_QUOTE = /^\s*<blockquote data-reply-uuid="[^"]*">([\s\S]*?)<\/blockquote>/

// replyQuote splits an agent reply into {author, text, body}; null without a quote.
export function replyQuote(content) {
  const match = REPLY_QUOTE.exec(content || '')
  if (!match) return null
  const line = unescapeHTML(match[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
  const sep = line.indexOf(': ')
  return {
    author: sep > 0 ? line.slice(0, sep) : '',
    text: sep > 0 ? line.slice(sep + 2) : line,
    body: content.slice(match[0].length)
  }
}

// Reactions an agent can send: the set both Zalo and Messenger understand.
export const REACTION_CHOICES = ['❤️', '👍', '😆', '😮', '😢', '😡']

const bareEmoji = (e) => String(e || '').replace(/\uFE0F/g, '')

// nextReaction is what to send when the agent picks `choice`: picking the
// emoji the account already reacted with removes it ("").
export function nextReaction(choice, reactions) {
  const mine = (reactions || []).some((r) => r.mine && bareEmoji(r.emoji) === bareEmoji(choice))
  return mine ? '' : choice
}

// canRecallInbox: Messenger does not let a Page recall or edit what it sent,
// and the Zalo OA OpenAPI has no recall either.
export function canRecallInbox(conversation) {
  return isOmnichannelInbox(conversation) && !/^(Fanpage|Zalo OA|Fanpage Web) - /.test(conversation?.inbox_name || '')
}
