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

// isOmnichannelInbox: inboxes the gateway creates are named "Zalo - acc" / "Facebook - acc".
export function isOmnichannelInbox(conversation) {
  return /^(Zalo|Facebook) - /.test(conversation?.inbox_name || '')
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

// Reactions an agent can send: the set both Zalo and Messenger understand.
export const REACTION_CHOICES = ['❤️', '👍', '😆', '😮', '😢', '😡']

const bareEmoji = (e) => String(e || '').replace(/\uFE0F/g, '')

// nextReaction is what to send when the agent picks `choice`: picking the
// emoji the account already reacted with removes it ("").
export function nextReaction(choice, reactions) {
  const mine = (reactions || []).some((r) => r.mine && bareEmoji(r.emoji) === bareEmoji(choice))
  return mine ? '' : choice
}
