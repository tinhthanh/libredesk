<template>
  <div class="flex flex-col relative h-full">
    <div ref="threadEl" class="flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]" @scroll="handleScroll">
      <div ref="contentEl" class="min-h-full px-4 pb-10 relative">
        <div
          v-if="showLoadMore"
          class="text-center mt-3"
        >
          <Button
            size="sm"
            variant="outline"
            @click="loadMore"
            :disabled="conversationStore.messages.fetching"
            class="max-md:h-11 transition-all duration-200 hover:bg-accent hover:scale-105 active:scale-95"
          >
            <Loader2
              v-if="conversationStore.messages.fetching"
              size="16"
              class="mr-2 animate-spin"
            />
            <RefreshCw v-else size="16" class="mr-2" />
            {{ $t('globals.terms.loadMore') }}
          </Button>
        </div>

        <MessagesSkeleton :count="10" v-if="conversationStore.messages.loading" />

        <TransitionGroup v-else enter-active-class="animate-slide-in" leave-active-class="message-leaving" tag="div">
          <div
            v-for="row in messageRows"
            :key="row.message.uuid"
            :data-message-uuid="row.message.uuid"
            :class="[row.spacingClass, { 'my-2': row.message.type === 'activity' }]"
          >
            <DaySeparator
              v-if="row.showDaySeparator"
              :date="row.message.created_at"
              class="mb-4"
            />
            <div v-if="!row.message.private && row.message.type !== 'activity'">
              <MessageBubble
                :message="row.message"
                :direction="row.message.type"
                :group-with-prev="row.groupWithPrev"
                :group-with-next="row.groupWithNext"
                :seen="row.message.uuid === lastSeenUUID"
                :reactions="reactionsFor(row.message.uuid)"
              />
            </div>
            <div v-else-if="row.message.type === 'outgoing' && row.message.private">
              <MessageBubble
                :message="row.message"
                direction="outgoing"
                :group-with-prev="row.groupWithPrev"
                :group-with-next="row.groupWithNext"
                :reactions="reactionsFor(row.message.uuid)"
              />
            </div>
            <div v-else-if="row.message.type === 'activity'">
              <ActivityMessageBubble :message="row.message" />
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- Typing indicator -->
      <div v-if="conversationStore.conversation.isTyping" class="px-4 pb-4">
        <TypingIndicator />
      </div>
    </div>

    <!-- Sticky container for the scroll arrow -->
    <ScrollToBottomButton
      :is-at-bottom="!hasUserScrolled"
      :unread-count="unReadMessages"
      @scroll-to-bottom="handleScrollToBottom"
    />

    <!-- Nudge to self-assign after replying to an unassigned conversation -->
    <AssignSelfNudge
      :show="showAssignNudge"
      @assign="assignToSelf"
      @dismiss="showAssignNudge = false"
    />
  </div>
</template>

<script setup>
import { groupSender, isOmnichannelInbox } from '@main/utils/omnichannel.js'
import api from '@main/api'
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import MessageBubble from './MessageBubble.vue'
import ActivityMessageBubble from './ActivityMessageBubble.vue'
import { useConversationStore } from '@main/stores/conversation'
import { useUserStore } from '@main/stores/user'
import { Button } from '@shared-ui/components/ui/button'
import { RefreshCw, Loader2 } from 'lucide-vue-next'
import ScrollToBottomButton from '@shared-ui/components/ScrollToBottomButton'
import DaySeparator from '@shared-ui/components/DaySeparator'
import { isSameDay } from 'date-fns'
import AssignSelfNudge from './AssignSelfNudge.vue'
import { useEmitter } from '@main/composables/useEmitter'
import { EMITTER_EVENTS } from '@main/constants/emitterEvents'
import { useBulkActionPermissions } from '@main/composables/useBulkActionPermissions'
import MessagesSkeleton from './MessagesSkeleton.vue'
import { TypingIndicator } from '@shared-ui/components/TypingIndicator'
import { useStickyScroll } from '@shared-ui/composables'

const MENTION_TOP_OFFSET_RATIO = 0.25
const MENTION_SETTLE_FRAMES = 3
const MENTION_MAX_ANCHOR_FRAMES = 90
const HIGHLIGHT_MS = 2500

const route = useRoute()

const conversationStore = useConversationStore()
const userStore = useUserStore()
const threadEl = ref(null)
const contentEl = ref(null)
const emitter = useEmitter()
const unReadMessages = ref(0)
const showAssignNudge = ref(false)
const { canAssignAgent } = useBulkActionPermissions()
let currentConversationUUID = ''
let openScrollDone = false

const assignToSelf = () => {
  conversationStore.updateAssignee('user', { assignee_id: userStore.userID })
}

const { hasUserScrolled, scrollToBottom, scrollToOffset, handleScroll } = useStickyScroll(threadEl, contentEl, {
  onArriveBottom: () => { unReadMessages.value = 0 }
})

const handleScrollToBottom = () => {
  hasUserScrolled.value = false
  scrollToBottom()
}

const applyOpenScroll = () => {
  const thread = threadEl.value
  if (!thread) return
  const targetUUID = route.query.scrollTo
  const targetEl = targetUUID ? thread.querySelector(`[data-message-uuid="${targetUUID}"]`) : null
  if (targetEl) {
    hasUserScrolled.value = true
    // Messages above the target collapse to max-h after mount, so re-pin until offsetTop stops moving.
    let lastOffset = -1
    let stableFrames = 0
    let frames = 0
    const anchorToTarget = () => {
      if (!threadEl.value || !targetEl.isConnected) return
      const offset = targetEl.offsetTop
      scrollToOffset(Math.max(0, offset - threadEl.value.clientHeight * MENTION_TOP_OFFSET_RATIO))
      stableFrames = offset === lastOffset ? stableFrames + 1 : 0
      lastOffset = offset
      if (stableFrames < MENTION_SETTLE_FRAMES && ++frames < MENTION_MAX_ANCHOR_FRAMES) requestAnimationFrame(anchorToTarget)
    }
    anchorToTarget()
    targetEl.classList.add('highlight-mention')
    setTimeout(() => targetEl.classList.remove('highlight-mention'), HIGHLIGHT_MS)
  } else {
    hasUserScrolled.value = false
    scrollToBottom()
  }
}

const newMessageHandler = (data) => {
  if (data.conversation_uuid !== conversationStore.current.uuid) return
  const message = data.message
  if (message?.sender_id === userStore.userID) {
    hasUserScrolled.value = false
    if (
      message.type === 'outgoing' &&
      !message.private &&
      !conversationStore.current.assigned_user_id &&
      canAssignAgent.value
    ) {
      showAssignNudge.value = true
    }
    return
  }
  if (hasUserScrolled.value) unReadMessages.value++
}

onMounted(() => {
  emitter.on(EMITTER_EVENTS.NEW_MESSAGE, newMessageHandler)
})

// omnichannel: customer "seen" and "typing" from the gateway, polled while a
// Zalo/Facebook conversation is open (Libredesk's own typing indicator is reused).
const PRESENCE_POLL_MS = 4000
const presence = ref({ conversationUUID: '', readAt: '', readUUID: '', reactions: {} })
let presenceTimer = null
const pollPresence = async () => {
  const conv = conversationStore.current
  if (!conv?.uuid || !isOmnichannelInbox(conv)) return
  try {
    const { data } = await api.getChannelPresence(conv.uuid)
    if (conversationStore.current?.uuid !== conv.uuid) return
    presence.value = {
      conversationUUID: conv.uuid,
      readAt: data.read_at || '',
      readUUID: data.read_uuid || '',
      reactions: data.reactions || {}
    }
    if (conversationStore.conversation.isTyping !== !!data.typing) conversationStore.conversation.isTyping = !!data.typing
  } catch {
    // Gateway chưa hỗ trợ / lỗi mạng: bỏ qua, lần sau hỏi lại.
  }
}
watch(
  () => conversationStore.current?.uuid,
  () => {
    clearInterval(presenceTimer)
    presence.value = { conversationUUID: '', readAt: '', readUUID: '', reactions: {} }
    if (isOmnichannelInbox(conversationStore.current)) {
      pollPresence()
      presenceTimer = setInterval(pollPresence, PRESENCE_POLL_MS)
    }
  },
  { immediate: true }
)
const NO_REACTIONS = []
const reactionsFor = (uuid) => presence.value.reactions[uuid] || NO_REACTIONS
// The latest agent reply the customer has seen: the exact message when the
// platform reports ids, otherwise the last one sent before the read time.
const lastSeenUUID = computed(() => {
  const p = presence.value
  if (!p.readAt || p.conversationUUID !== conversationStore.current?.uuid) return ''
  const sent = conversationStore.conversationMessages.filter((m) => m.type === 'outgoing' && !m.private)
  if (p.readUUID && sent.some((m) => m.uuid === p.readUUID)) {
    const idx = sent.findIndex((m) => m.uuid === p.readUUID)
    const later = sent.slice(idx + 1).filter((m) => new Date(m.created_at) <= new Date(p.readAt))
    return later.length ? later[later.length - 1].uuid : p.readUUID
  }
  const before = sent.filter((m) => new Date(m.created_at) <= new Date(p.readAt))
  return before.length ? before[before.length - 1].uuid : ''
})

onUnmounted(() => {
  clearInterval(presenceTimer)
  emitter.off(EMITTER_EVENTS.NEW_MESSAGE, newMessageHandler)
})

watch(
  () => conversationStore.current?.uuid,
  (newUUID) => {
    if (!newUUID || newUUID === currentConversationUUID) return
    currentConversationUUID = newUUID
    unReadMessages.value = 0
    openScrollDone = false
    showAssignNudge.value = false
  }
)

watch(
  () => conversationStore.current?.assigned_user_id,
  (assignedUserId) => {
    if (assignedUserId) showAssignNudge.value = false
  }
)

watch(
  () => [conversationStore.conversationMessages.length, conversationStore.messages.loading],
  ([len, loading]) => {
    if (openScrollDone || loading || !len) return
    openScrollDone = true
    hasUserScrolled.value = !!route.query.scrollTo
    nextTick(applyOpenScroll)
  },
  { immediate: true }
)

// Watch for typing indicator and auto-scroll if user is at bottom
watch(
  () => conversationStore.conversation.isTyping,
  (isTyping) => {
    if (isTyping && !hasUserScrolled.value) nextTick(scrollToBottom)
  }
)

const GROUP_WINDOW_MS = 60_000

const canGroup = (a, b) => {
  if (!a || !b) return false
  if (a.type === 'activity' || b.type === 'activity') return false
  if (a.type !== b.type) return false
  if (Boolean(a.private) !== Boolean(b.private)) return false
  if (a.status === 'failed' || b.status === 'failed') return false

  const aSenderId = a.author?.id ?? a.sender_id
  const bSenderId = b.author?.id ?? b.sender_id
  if (!aSenderId || aSenderId !== bSenderId) return false
  // omnichannel: in a group contact, a new "[Sender]: " starts a new group.
  const bMember = groupSender(b)
  if (bMember && bMember !== groupSender(a)) return false

  const aBucket = Math.floor(new Date(a.created_at).getTime() / GROUP_WINDOW_MS)
  const bBucket = Math.floor(new Date(b.created_at).getTime() / GROUP_WINDOW_MS)
  return aBucket === bBucket
}

const getSpacingClass = (index, groupWithPrev) => {
  if (index === 0) return 'pt-4'
  return groupWithPrev ? 'mt-1' : 'mt-4'
}

const showLoadMore = computed(
  () => conversationStore.currentConversationHasMoreMessages && !conversationStore.messages.loading
)

const loadMore = async () => {
  const thread = threadEl.value
  if (!thread) return
  const prevHeight = thread.scrollHeight
  const prevTop = thread.scrollTop
  await conversationStore.fetchNextMessages()
  await nextTick()
  thread.scrollTop = thread.scrollHeight - prevHeight + prevTop
}

const messageRows = computed(() => {
  const messages = conversationStore.conversationMessages
  return messages.map((message, index) => {
    const groupWithPrev = canGroup(messages[index - 1], message)
    const groupWithNext = canGroup(message, messages[index + 1])
    return {
      message,
      groupWithPrev,
      groupWithNext,
      spacingClass: getSpacingClass(index, groupWithPrev),
      showDaySeparator:
        index === 0 ||
        !isSameDay(new Date(messages[index - 1].created_at), new Date(message.created_at))
    }
  })
})
</script>

<style scoped>
/* Leaving messages must be out of flow during a conversation swap, else they shift the target's offsetTop mid-scroll. */
.message-leaving {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

/* Highlight via an opacity-faded overlay, not the element's own background, to avoid a text repaint flicker when it ends. */
.highlight-mention {
  position: relative;
}

.highlight-mention::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.5rem;
  background-color: rgb(251 191 36 / 0.35);
  pointer-events: none;
  animation: highlightFade 2.5s ease-out forwards;
}

:global(.dark .highlight-mention::after) {
  background-color: rgb(250 204 21 / 0.2);
}

@keyframes highlightFade {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
</style>
