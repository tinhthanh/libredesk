import { ref } from 'vue'
import {
  eventNote,
  isOmnichannelInbox,
  quoteTarget as coreQuoteTarget,
  richCard
} from '@omni-core'

// omnichannel: the pure helpers (gateway inbox names, group senders, owner
// replies, stickers, quote replies, reactions) live in omni-core, shared with
// the Vetgo app. Only Vue state stays here.
export {
  groupSender,
  stripGroupSender,
  senderAvatarURL,
  isOmnichannelInbox,
  omniChannel,
  ownerReply,
  ownerPreview,
  isSticker,
  imagePreviewSrc,
  isStickerOnly,
  quoteText,
  quoteHTML,
  replyQuote,
  customerQuote,
  quotePreview,
  REACTION_CHOICES,
  nextReaction,
  canRecallInbox
} from '@omni-core'

// Quote replies: one target at a time, tied to its conversation.
export const replyTarget = ref(null) // { conversationUUID, uuid, author, text }

// quoteTarget builds the reply target for an incoming message of a conversation.
export function quoteTarget(conversationUUID, message) {
  return { conversationUUID, ...coreQuoteTarget(message) }
}

// Gateway notes and structured messages drawn like the Vetgo app (omni-core
// eventNote, richCard). Only in gateway inboxes: a staff note in an email inbox
// that starts with 📞 stays a note.

// hasOmniMarkers: the gateway of this conversation tags its notes with
// meta.omni_event, so an untagged note written after the marker date is staff's.
export function hasOmniMarkers(messages) {
  return (messages || []).some((m) => m?.private && typeof m?.meta?.omni_event === 'string')
}

export function omniEventNote(message, conversation, markersSeen) {
  return isOmnichannelInbox(conversation) ? eventNote(message, { markersSeen }) : null
}

export function omniRichCard(message, conversation) {
  return isOmnichannelInbox(conversation) ? richCard(message) : null
}

// i18n key of the button that opens a rich card's link ('' = no button label of its own).
const RICH_ACTIONS = {
  link: 'conversation.omni.rich.openLink',
  contact: 'conversation.omni.rich.viewQr',
  location: 'conversation.omni.rich.openMap',
  video: 'conversation.omni.rich.openVideo'
}

export function richActionKey(kind) {
  return RICH_ACTIONS[kind] || 'conversation.omni.rich.open'
}
