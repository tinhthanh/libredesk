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
