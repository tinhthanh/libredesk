import { ref } from 'vue'
import { quoteTarget as coreQuoteTarget } from '@omni-core'

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
