import { ref } from 'vue'

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
  quoteTarget,
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
