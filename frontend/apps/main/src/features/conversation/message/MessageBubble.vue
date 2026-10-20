<template>
  <div class="flex flex-col text-left" :class="isOutgoing ? 'items-end' : 'items-start'">
    <!-- Sender Name -->
    <div
      v-if="!groupWithPrev"
      class="mb-1 flex items-center gap-1"
      :class="isOutgoing ? 'pr-2 md:pr-[47px]' : 'pl-10 md:pl-[47px]'"
    >
      <router-link
        v-if="!isOutgoing"
        :to="{ name: 'contact-detail', params: { id: message.author?.id } }"
        class="cursor-pointer text-muted-foreground text-sm font-medium hover:underline hover:text-foreground transition-colors duration-200"
      >
        {{ getFullName }}
      </router-link>
      <router-link
        v-else-if="canManageAI"
        :to="aiAssistantRoute"
        class="cursor-pointer text-muted-foreground text-sm font-medium hover:underline hover:text-foreground transition-colors duration-200"
      >
        {{ getFullName }}
      </router-link>
      <router-link
        v-else-if="canManageUsers"
        :to="{ name: 'edit-agent', params: { id: message.author?.id } }"
        class="cursor-pointer text-muted-foreground text-sm font-medium hover:underline hover:text-foreground transition-colors duration-200"
      >
        {{ getFullName }}
      </router-link>
      <p v-else class="text-muted-foreground text-sm font-medium">
        {{ getFullName }}
      </p>
    </div>

    <!-- Message Bubble -->
    <div class="flex flex-row gap-2 w-full group" :class="{ 'justify-end': isOutgoing }">
      <!-- Avatar (left for incoming) -->
      <template v-if="!isOutgoing">
        <router-link
          v-if="!groupWithPrev"
          :to="{ name: 'contact-detail', params: { id: message.author?.id } }"
          class="flex-shrink-0"
        >
          <Avatar class="cursor-pointer w-8 h-8 hover:opacity-80 transition-opacity">
            <AvatarImage :src="getAvatar" />
            <AvatarFallback class="font-medium">
              {{ avatarFallback }}
            </AvatarFallback>
          </Avatar>
        </router-link>
        <div v-else class="w-8 flex-shrink-0" />
      </template>

      <div
        class="w-full md:w-4/5"
        :class="{ 'flex justify-end items-center gap-2': isOutgoing, 'flex items-center gap-2': canQuote }"
        style="contain: inline-size"
      >
        <!-- Delete note menu (private notes, appears on hover, left of bubble) -->
        <div
          v-if="canDeleteNote || canRecall"
          class="flex-shrink-0 transition-opacity duration-200 can-hover:opacity-0 can-hover:group-hover:opacity-100 focus-within:!opacity-100"
        >
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" class="w-8 h-8 p-0 text-muted-foreground">
                <MoreHorizontal class="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                v-if="canDeleteNote"
                class="text-destructive focus:text-destructive"
                @click="alertOpen = true"
              >
                <Trash2 class="mr-2 h-4 w-4" />
                {{ t('conversation.deletePrivateNote') }}
              </DropdownMenuItem>
              <DropdownMenuItem v-if="canEdit" @click="openEdit">
                <Pencil class="mr-2 h-4 w-4" />
                {{ t('conversation.editMessage') }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="canRecall"
                class="text-destructive focus:text-destructive"
                @click="recallOpen = true"
              >
                <Undo2 class="mr-2 h-4 w-4" />
                {{ t('conversation.recallMessage') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <!-- omnichannel: wrapper so the reaction pill can sit on the bubble's edge -->
        <div
          class="relative flex flex-col max-w-full md:min-w-[30%]"
          :class="{ 'mb-3': reactions.length }"
        >
          <div
            class="flex flex-col justify-end message-bubble !w-full"
            :class="bubbleClasses"
          >
            <div v-if="isDeleted" class="text-sm italic text-muted-foreground">
              {{ message.content }}
            </div>
            <template v-else>
              <!-- Message Envelope -->
              <MessageEnvelope :message="message" v-if="showEnvelope" />

              <hr class="mb-2 border-muted-foreground/20" v-if="showEnvelope" />

              <!-- Message Content -->
              <div
                ref="contentWrapperEl"
                class="relative"
                :class="{ 'max-h-[400px] overflow-hidden': isExpandable && !isExpanded }"
              >
                <div
                  v-if="message.content_type === 'text'"
                  class="mb-1 native-html whitespace-pre-wrap"
                  :class="{ 'mb-3': message.attachments.length > 0 }"
                >
                  {{ sanitizedContent }}
                </div>
                <div v-else ref="messageContentEl" @click="onMessageContentClick">
                  <Letter
                    :html="sanitizedContent"
                    :allowedSchemas="['cid', 'https', 'http', 'mailto']"
                    :allowed-css-properties="extendedCssProperties"
                    class="mb-1 native-html break-words"
                    :class="{ 'mb-3': message.attachments.length > 0 }"
                  />
                </div>

                <div
                  v-if="isExpandable && !isExpanded"
                  class="absolute left-0 right-0 bottom-0 h-24 flex items-end justify-center pointer-events-none"
                  :class="
                    message.private
                      ? 'bg-gradient-to-t from-private via-private/90 to-transparent'
                      : isOutgoing
                        ? 'bg-gradient-to-t from-secondary via-secondary/90 to-transparent'
                        : 'bg-gradient-to-t from-background via-background/90 to-transparent'
                  "
                >
                  <button
                    type="button"
                    @click="isExpanded = true"
                    class="pointer-events-auto flex items-center gap-1.5 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 border border-border rounded-full px-3 py-1 mb-1 transition-colors duration-200"
                  >
                    <Maximize2 :size="12" />
                    {{ t('globals.terms.expand') }}
                  </button>
                </div>
              </div>

              <ImageLightbox
                v-model="inlineLightboxOpen"
                :images="inlineImages"
                :start-index="inlineLightboxIndex"
              />

              <!-- Quoted Text Toggle (incoming only) -->
              <div
                v-if="!isOutgoing && hasQuotedContent"
                @click="toggleQuote"
                class="text-xs cursor-pointer text-muted-foreground px-2 py-1 w-max hover:bg-muted hover:text-foreground rounded-md transition-colors duration-200"
              >
                {{ showQuotedText ? t('conversation.hideQuotedText') : t('conversation.showQuotedText') }}
              </div>

              <!-- Attachments -->
              <BubbleAttachmentPreview :attachments="nonInlineAttachments" />

              <!-- CSAT Response -->
              <CSATResponseDisplay :message="message" />

              <!-- omnichannel: the customer has seen up to this reply -->
              <div v-if="seen && isOutgoing" class="text-xs text-muted-foreground self-end">
                {{ t('conversation.seenByCustomer') }}
              </div>
              <!-- omnichannel: edited on Facebook in this session -->
              <div v-if="editedText" class="text-xs italic text-muted-foreground self-end">
                {{ t('conversation.editedTo', { text: editedText }) }}
              </div>
              <!-- omnichannel: recalled on Zalo/Facebook in this session -->
              <div v-if="recalled" class="text-xs italic text-muted-foreground self-end">
                {{ t('conversation.recalled') }}
              </div>

              <!-- Spinner for Pending Messages (outgoing only) -->
              <Spinner v-if="isOutgoing && message.status === 'pending'" size="sm" />

              <!-- Status Icons (outgoing only) -->
              <div v-if="isOutgoing" class="flex items-center space-x-2 mt-2 self-end">
                <Lock :size="12" v-if="isPrivateMessage" class="text-muted-foreground" />
                <Check :size="14" v-if="showCheckCheck" class="text-success" />
                <Tooltip v-if="message.meta?.continuity_emailed">
                  <TooltipTrigger>
                    <Mail :size="12" class="text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{{ t('conversation.sentViaEmail') }}</p>
                  </TooltipContent>
                </Tooltip>
                <RotateCcw
                  size="12"
                  @click="retryMessage(message)"
                  class="cursor-pointer text-muted-foreground hover:text-foreground transition-colors duration-200"
                  v-if="showRetry"
                />
              </div>
            </template>
          </div>
          <!-- omnichannel: customer reactions on Zalo/Facebook, shown like the apps do -->
          <div
            v-if="reactions.length"
            class="absolute -bottom-3 right-3 flex items-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-0.5 text-xs shadow-sm"
            :title="reactionTitle"
          >
            <span v-for="r in reactions.slice(0, 3)" :key="r.emoji">{{ r.emoji }}</span>
            <span v-if="reactionCount > 1" class="ml-0.5 text-muted-foreground">{{ reactionCount }}</span>
          </div>
        </div>

        <!-- omnichannel: quote this customer message in the reply (appears on hover) -->
        <div
          v-if="canQuote"
          class="flex-shrink-0 self-center transition-opacity duration-200 can-hover:opacity-0 can-hover:group-hover:opacity-100 focus-within:!opacity-100"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                class="w-8 h-8 p-0 text-muted-foreground"
                :aria-label="t('conversation.quoteReply')"
                @click="quoteMessage"
              >
                <Reply class="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t('conversation.quoteReply') }}</TooltipContent>
          </Tooltip>
          <!-- omnichannel: react to the customer message on Zalo/Facebook -->
          <Popover v-model:open="reactOpen">
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                class="w-8 h-8 p-0 text-muted-foreground"
                :aria-label="t('conversation.react')"
                :title="t('conversation.react')"
              >
                <SmilePlus class="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-1 flex gap-0.5" side="top">
              <button
                v-for="choice in REACTION_CHOICES"
                :key="choice"
                type="button"
                class="rounded-md px-1.5 py-1 text-lg hover:bg-accent disabled:opacity-50"
                :class="{ 'bg-accent': nextReaction(choice, reactions) === '' }"
                :disabled="reacting"
                @click="react(choice)"
              >
                {{ choice }}
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <!-- Avatar (right for outgoing) -->
      <template v-if="isOutgoing">
        <div v-if="groupWithPrev" class="w-8 flex-shrink-0" />
        <router-link
          v-else-if="canManageAI"
          :to="aiAssistantRoute"
          class="flex-shrink-0"
        >
          <Avatar class="cursor-pointer w-8 h-8 hover:opacity-80 transition-opacity">
            <AvatarImage :src="getAvatar" />
            <AvatarFallback class="font-medium">
              {{ avatarFallback }}
            </AvatarFallback>
          </Avatar>
        </router-link>
        <router-link
          v-else-if="canManageUsers"
          :to="{ name: 'edit-agent', params: { id: message.author?.id } }"
          class="flex-shrink-0"
        >
          <Avatar class="cursor-pointer w-8 h-8 hover:opacity-80 transition-opacity">
            <AvatarImage :src="getAvatar" />
            <AvatarFallback class="font-medium">
              {{ avatarFallback }}
            </AvatarFallback>
          </Avatar>
        </router-link>
        <Avatar v-else class="w-8 h-8">
          <AvatarImage :src="getAvatar" />
          <AvatarFallback class="font-medium">
            {{ avatarFallback }}
          </AvatarFallback>
        </Avatar>
      </template>
    </div>

    <!-- Timestamp tooltip -->
    <div v-if="!groupWithNext" :class="isOutgoing ? 'pr-[47px]' : 'pl-[47px]'">
      <Tooltip>
        <TooltipTrigger>
          <span class="text-muted-foreground text-xs mt-1">
            {{ formatMessageTimestamp(message.created_at) }}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ formatFullTimestamp(message.created_at) }}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  </div>

  <Dialog :open="editOpen" @update:open="editOpen = $event">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>{{ t('conversation.editMessage') }}</DialogTitle>
        <DialogDescription>{{ t('conversation.editHint') }}</DialogDescription>
      </DialogHeader>
      <Textarea v-model="editDraft" rows="4" />
      <DialogFooter>
        <Button variant="outline" @click="editOpen = false">{{ t('globals.messages.cancel') }}</Button>
        <Button :disabled="editSaving || !editDraft.trim()" @click="saveEdit">{{ t('globals.messages.save') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <AlertDialog :open="recallOpen" @update:open="recallOpen = $event">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('conversation.recallMessage') }}</AlertDialogTitle>
        <AlertDialogDescription>{{ t('conversation.recallConfirm') }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t('globals.messages.cancel') }}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="recallMessage">{{ t('conversation.recallMessage') }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <AlertDialog :open="alertOpen" @update:open="alertOpen = $event">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('globals.messages.areYouAbsolutelySure') }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t('conversation.deletePrivateNoteConfirmation') }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t('globals.messages.cancel') }}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="deleteNote">{{ t('globals.messages.delete') }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup>
import { computed, ref, onMounted, nextTick } from 'vue'
import { useConversationStore } from '@main/stores/conversation'
import { useUserStore } from '@main/stores/user'
import { useI18n } from 'vue-i18n'
import { Lock, Mail, RotateCcw, Check, Maximize2, Trash2, MoreHorizontal, Reply, Undo2, Pencil, SmilePlus } from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@shared-ui/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '@shared-ui/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shared-ui/components/ui/alert-dialog'
import { Button } from '@shared-ui/components/ui/button'
import { Textarea } from '@shared-ui/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shared-ui/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared-ui/components/ui/tooltip'
import { Spinner } from '@shared-ui/components/ui/spinner'
import { formatMessageTimestamp, formatFullTimestamp } from '@shared-ui/utils/datetime.js'
import { Avatar, AvatarFallback, AvatarImage } from '@shared-ui/components/ui/avatar'
import { Letter } from 'vue-letter'
import { allowedCssProperties } from 'lettersanitizer'
import ImageLightbox from '@/components/ImageLightbox.vue'
import BubbleAttachmentPreview from '@main/features/conversation/message/attachment/BubbleAttachmentPreview.vue'
import MessageEnvelope from './MessageEnvelope.vue'
import CSATResponseDisplay from './CSATResponseDisplay.vue'
import api from '@main/api'
import { useEmitter } from '@main/composables/useEmitter'
import { EMITTER_EVENTS } from '@main/constants/emitterEvents.js'
import { errorMessage } from '@main/features/admin/channel-accounts/channelAccounts.js'
import { containsQuoteMarkers } from '@shared-ui/utils/quotedContent.js'
import {
  canRecallInbox,
  groupSender,
  isOmnichannelInbox,
  nextReaction,
  quoteTarget,
  REACTION_CHOICES,
  replyTarget,
  stripGroupSender,
  senderAvatarURL
} from '@main/utils/omnichannel.js'

const extendedCssProperties = [...allowedCssProperties, 'transform', 'transform-origin']

const COLLAPSE_THRESHOLD_PX = 400

const contentWrapperEl = ref(null)
const isExpandable = ref(false)
const isExpanded = ref(false)

const measureExpandable = () => {
  const el = contentWrapperEl.value
  if (!el) return
  isExpandable.value = el.scrollHeight > COLLAPSE_THRESHOLD_PX
}

onMounted(async () => {
  await nextTick()
  measureExpandable()

  // Email HTML images change height after initial paint - re-measure on load.
  const imgs = contentWrapperEl.value?.querySelectorAll?.('img') ?? []
  imgs.forEach((img) => {
    if (!img.complete) img.addEventListener('load', measureExpandable, { once: true })
  })
})

const props = defineProps({
  // omnichannel: last agent reply the customer has seen
  seen: { type: Boolean, default: false },
  // omnichannel: [{emoji, count, names}] from the gateway, most used first
  reactions: { type: Array, default: () => [] },
  message: Object,
  direction: {
    type: String,
    validator: (v) => ['incoming', 'outgoing'].includes(v)
  },
  groupWithPrev: {
    type: Boolean,
    default: false
  },
  groupWithNext: {
    type: Boolean,
    default: false
  }
})

const convStore = useConversationStore()
const { t } = useI18n()
const userStore = useUserStore()
const emitter = useEmitter()

const alertOpen = ref(false)

const deleteNote = () => {
  const conversationUUID = convStore.current?.uuid
  if (!conversationUUID) return
  convStore.deleteMessage(conversationUUID, props.message.uuid)
  alertOpen.value = false
}

const isSystemUser = computed(() => props.message.author?.email === 'System')
const isAIAssistant = computed(() => props.message.author?.type === 'ai_assistant')
const canManageUsers = computed(
  () => !isSystemUser.value && !isAIAssistant.value && userStore.can('users:manage')
)
const canManageAI = computed(() => isAIAssistant.value && userStore.can('ai:manage'))
const aiAssistantRoute = computed(() => {
  const id = props.message.meta?.ai_assistant_id
  return id ? { name: 'edit-ai-assistant', params: { id } } : { name: 'ai-assistants' }
})

const isOutgoing = computed(() => props.direction === 'outgoing')

const reactionCount = computed(() => props.reactions.reduce((n, r) => n + r.count, 0))
const reactionTitle = computed(() =>
  props.reactions.map((r) => `${r.emoji} ${r.names.length ? r.names.join(', ') : r.count}`).join('\n')
)

// omnichannel: member of a Zalo/Facebook group, shown instead of the group contact.
const member = computed(() => groupSender(props.message))

// omnichannel: agents can quote a customer message; the gateway sends a native
// quoted reply on Zalo/Facebook.
const canQuote = computed(
  () =>
    !isOutgoing.value &&
    !props.message.private &&
    !!props.message.uuid &&
    props.message.status !== 'pending' &&
    isOmnichannelInbox(convStore.current)
)
const quoteMessage = () => {
  replyTarget.value = quoteTarget(convStore.current?.uuid, props.message)
}

// omnichannel: the bot reacts on Zalo/Facebook; the badge follows on the next
// presence poll (asked for right away below).
const reactOpen = ref(false)
const reacting = ref(false)
const react = async (choice) => {
  reacting.value = true
  try {
    await api.reactChannelMessage(props.message.uuid, convStore.current?.uuid, nextReaction(choice, props.reactions))
    reactOpen.value = false
    emitter.emit('omnichannel:reactions-changed')
  } catch (error) {
    emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description: errorMessage(error) })
  } finally {
    reacting.value = false
  }
}

const getFullName = computed(() => {
  if (member.value) return member.value
  const author = props.message.author ?? {}
  const firstName = author.first_name ?? 'User'
  const lastName = author.last_name ?? ''
  return `${firstName} ${lastName}`.trim()
})

const getAvatar = computed(() => {
  if (member.value) {
    return senderAvatarURL(convStore.current?.uuid, member.value)
  }
  return props.message.author?.avatar_url || ''
})

const avatarFallback = computed(() => {
  if (member.value) return member.value.toUpperCase().substring(0, 2)
  const firstName = props.message.author?.first_name ?? (isOutgoing.value ? 'A' : 'U')
  return firstName.toUpperCase().substring(0, 2)
})

const sanitizedContent = computed(() => {
  if (props.message.meta?.is_csat) {
    return t('globals.messages.pleaseRateConversation')
  }
  if (member.value) return stripGroupSender(props.message.content)
  return props.message.content || ''
})

const nonInlineAttachments = computed(() =>
  props.message.attachments.filter((attachment) => attachment.disposition !== 'inline')
)

const bubbleClasses = computed(() => ({
  'bg-private': isOutgoing.value && props.message.private,
  'bg-secondary border border-border': isOutgoing.value && !props.message.private,
  'opacity-50 animate-pulse': isOutgoing.value && props.message.status === 'pending',
  'border-destructive': isOutgoing.value && props.message.status === 'failed',
  relative: isOutgoing.value,
  'show-quoted-text': !isOutgoing.value && showQuotedText.value,
  'hide-quoted-text': !isOutgoing.value && !showQuotedText.value
}))

const isPrivateMessage = computed(() => isOutgoing.value && props.message.private)
const isDeleted = computed(() => !!props.message.meta?.deleted_at)
// omnichannel: recall an agent reply on Zalo/Facebook (gateway /gw/messages/…/recall).
const recallOpen = ref(false)
const recalled = ref(false)
const canRecall = computed(
  () =>
    isOutgoing.value &&
    !props.message.private &&
    !recalled.value &&
    props.message.status === 'sent' &&
    ['agent', 'ai_assistant'].includes(props.message.sender_type) &&
    canRecallInbox(convStore.current)
)
// omnichannel: Facebook lets the sender edit a sent message (Zalo does not).
const editOpen = ref(false)
const editDraft = ref('')
const editSaving = ref(false)
const editedText = ref('')
const canEdit = computed(() => canRecall.value && /^Facebook - /.test(convStore.current?.inbox_name || ''))
const openEdit = () => {
  editDraft.value = editedText.value || props.message.text_content || ''
  editOpen.value = true
}
const saveEdit = async () => {
  editSaving.value = true
  try {
    const text = editDraft.value.trim()
    await api.editChannelMessage(props.message.uuid, text)
    editedText.value = text
    editOpen.value = false
  } catch (error) {
    emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description: errorMessage(error) })
  } finally {
    editSaving.value = false
  }
}
const recallMessage = async () => {
  recallOpen.value = false
  try {
    await api.recallChannelMessage(props.message.uuid)
    recalled.value = true
    emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { description: t('conversation.recalled') })
  } catch (error) {
    emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description: errorMessage(error) })
  }
}

const canDeleteNote = computed(
  () =>
    isPrivateMessage.value &&
    !isDeleted.value &&
    (props.message.sender_id === userStore.userID || userStore.hasAdminRole)
)
const showCheckCheck = computed(
  () => isOutgoing.value && props.message.status === 'sent' && !isPrivateMessage.value
)
const showRetry = computed(() => isOutgoing.value && props.message.status === 'failed' && props.message.sender_id === userStore.userID)

const retryMessage = (msg) => {
  api.retryMessage(convStore.current.uuid, msg.uuid)
}

const showQuotedText = ref(false)
const hasQuotedContent = computed(
  () => !isOutgoing.value && containsQuoteMarkers(sanitizedContent.value)
)
const toggleQuote = () => {
  showQuotedText.value = !showQuotedText.value
}

// Enumerate from rendered DOM (not HTML source) to inherit vue-letter's
// sanitization and dodge regex parsing of attributes containing '>'.
const messageContentEl = ref(null)
const inlineLightboxOpen = ref(false)
const inlineLightboxIndex = ref(0)
const inlineImages = ref([])

// Re-walk on click instead of caching - cheaper than watching sanitizedContent
// and always reflects what the user actually sees.
const refreshInlineImages = () => {
  const root = messageContentEl.value
  if (!root) {
    inlineImages.value = []
    return
  }
  inlineImages.value = Array.from(root.querySelectorAll('img'))
    .map((el) => ({ url: el.getAttribute('src'), name: el.getAttribute('alt') || '' }))
    .filter((img) => img.url)
}

const onMessageContentClick = (event) => {
  // closest('img') so clicks on <a><img></a> wrappers still resolve.
  const img = event.target?.closest?.('img')
  if (!img || !messageContentEl.value?.contains(img)) return

  // Suppress anchor navigation so the lightbox can take over.
  const wrappingAnchor = img.closest('a')
  if (wrappingAnchor && messageContentEl.value.contains(wrappingAnchor)) {
    event.preventDefault()
  }

  refreshInlineImages()
  const src = img.getAttribute('src')
  const idx = inlineImages.value.findIndex((entry) => entry.url === src)
  inlineLightboxIndex.value = idx >= 0 ? idx : 0
  inlineLightboxOpen.value = true
}

const showEnvelope = computed(() => {
  return (
    props.message.meta?.from?.length ||
    props.message.meta?.to?.length ||
    props.message.meta?.cc?.length ||
    props.message.meta?.bcc?.length ||
    props.message.meta?.subject
  )
})
</script>

<style scoped lang="scss">
.native-html :deep(img) {
  max-width: 100%;
  height: auto;
  cursor: zoom-in;
}
</style>
