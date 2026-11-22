<template>
  <!-- Fanpage Web (omnichannel docs/plan-fbweb-call.md, P3, P4): khách gọi Trang qua Messenger, hoặc Trang gọi
       khách (📞). Đang đổ chuông thì Nghe máy / Tắt chuông; đang gọi hay đang nói thì trạng thái, micro, Cúp.
       Nghe và nói bằng micro, loa của trình duyệt. -->
  <div v-if="visible" class="flex items-center gap-1">
    <template v-if="inCall">
      <span
        class="text-xs whitespace-nowrap px-2 py-1 rounded-md"
        :class="fbwebCall.state === 'in_call' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-muted text-muted-foreground'"
        data-testid="fbweb-call-status"
      >
        {{ statusText }}
      </span>
      <Button
        variant="ghost"
        class="w-11 h-11 md:w-8 md:h-8 p-0"
        :aria-label="fbwebCall.muted ? t('conversation.call.unmute') : t('conversation.call.mute')"
        :disabled="fbwebCall.state !== 'in_call'"
        @click="toggleFbwebMute"
      >
        <MicOff v-if="fbwebCall.muted" class="w-4 h-4 text-destructive" />
        <Mic v-else class="w-4 h-4" />
      </Button>
      <Button
        variant="destructive"
        class="w-11 h-11 md:w-8 md:h-8 p-0"
        :aria-label="t('conversation.dial.hangup')"
        data-testid="fbweb-hangup"
        @click="hangupFbwebCall"
      >
        <PhoneOff class="w-4 h-4" />
      </Button>
    </template>
    <template v-else-if="ring">
      <span class="text-xs whitespace-nowrap px-2 py-1 rounded-md bg-muted text-muted-foreground" data-testid="fbweb-call-status">
        {{ t('conversation.dial.incoming') }}
      </span>
      <Button
        class="h-11 md:h-8 px-2 bg-green-600 hover:bg-green-700 text-white"
        :disabled="busy || fbwebCall.state !== 'idle'"
        @click="answer"
      >
        <Phone class="w-4 h-4 md:mr-1" /><span class="hidden md:inline">{{ t('conversation.dial.answer') }}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="destructive"
            class="w-11 h-11 md:w-8 md:h-8 p-0"
            :aria-label="t('conversation.fbwebCall.silence')"
            :disabled="busy"
            @click="silence"
          >
            <BellOff class="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ t('conversation.fbwebCall.silenceHint') }}</TooltipContent>
      </Tooltip>
    </template>
    <!-- Trang gọi khách: chỉ khi không có cuộc gọi nào đang mở trên trình duyệt này. -->
    <Tooltip v-else-if="fbwebCall.state === 'idle'">
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          class="w-11 h-11 md:w-8 md:h-8 p-0"
          :aria-label="t('conversation.fbwebCall.start')"
          :disabled="busy"
          data-testid="fbweb-call-start"
          @click="callCustomer"
        >
          <PhoneOutgoing class="w-4 h-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ t('conversation.fbwebCall.startHint') }}</TooltipContent>
    </Tooltip>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellOff, Mic, MicOff, Phone, PhoneOff, PhoneOutgoing } from 'lucide-vue-next'
import { Button } from '@shared-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared-ui/components/ui/tooltip'
import { useConversationStore } from '@main/stores/conversation'
import { useUserStore } from '@main/stores/user'
import { useEmitter } from '@main/composables/useEmitter'
import { EMITTER_EVENTS } from '@main/constants/emitterEvents.js'
import { omniChannel } from '@main/utils/omnichannel.js'
import { accountListed, branchCalls, callFeature, ensureCallFeature, formatCallDuration } from '@main/utils/omnichannelCall.js'
import {
  answerFbwebCall,
  callFbwebCustomer,
  fbwebAccountOf,
  fbwebCall,
  fbwebSupported,
  hangupFbwebCall,
  isFbwebCall,
  isFbwebSilenced,
  silenceFbwebCall,
  toggleFbwebMute
} from '@main/utils/fbwebCall.js'

const { t } = useI18n()
const conversationStore = useConversationStore()
const userStore = useUserStore()
const emitter = useEmitter()
const busy = ref(false)
const now = ref(Date.now())
let tick = null

const conversation = computed(() => conversationStore.current)
const eligible = computed(() => omniChannel(conversation.value) === 'fanpage-web' && userStore.can('conversations:write') && fbwebSupported())
const visible = computed(() => eligible.value && accountListed(callFeature.fbwebAccounts, fbwebAccountOf(conversation.value)))
watch(
  () => [eligible.value, conversation.value?.uuid],
  ([yes]) => {
    if (yes) ensureCallFeature()
  },
  { immediate: true }
)

// Cuộc gọi đang đổ chuông của hội thoại này (danh sách thanh xanh hỏi gateway mỗi 3 giây).
const ring = computed(() =>
  branchCalls.list.find(
    (c) => isFbwebCall(c) && c.incoming && c.state === 'ringing' && c.conversation_uuid === conversation.value?.uuid && !isFbwebSilenced(c)
  ) || null
)
const inCall = computed(() => fbwebCall.state !== 'idle' && fbwebCall.conversationUUID === conversation.value?.uuid)
const elapsed = computed(() => (fbwebCall.answeredAt ? (now.value - fbwebCall.answeredAt) / 1000 : 0))
const statusText = computed(() => {
  switch (fbwebCall.state) {
    case 'in_call': return t('conversation.fbwebCall.talking', { time: formatCallDuration(elapsed.value) })
    case 'calling': return t('conversation.fbwebCall.calling')
    case 'ringing_out': return t('conversation.fbwebCall.ringingOut')
    default: return t('conversation.fbwebCall.answering')
  }
})

watch(
  () => fbwebCall.state === 'in_call',
  (on) => {
    clearInterval(tick)
    tick = on ? setInterval(() => (now.value = Date.now()), 1000) : null
  },
  { immediate: true }
)
onBeforeUnmount(() => clearInterval(tick))

const MIC_ERRORS = { mic: 'conversation.call.micDenied', insecure: 'conversation.dial.audioInsecure' }

async function answer () {
  if (!ring.value) return
  busy.value = true
  const res = await answerFbwebCall(ring.value)
  busy.value = false
  if (!res.ok && res.reason !== 'busy') {
    const description = MIC_ERRORS[res.reason] ? t(MIC_ERRORS[res.reason]) : res.error || t('conversation.fbwebCall.failed')
    emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description })
  }
}

// Kết quả cuộc gọi đi: báo nhân viên khi không nói chuyện được.
const OUTGOING_TOASTS = { no_answer: 'conversation.fbwebCall.noAnswer', ended: 'conversation.fbwebCall.endedEarly' }

async function callCustomer () {
  if (!conversation.value) return
  busy.value = true
  const pending = callFbwebCustomer(conversation.value)
  // Nút trở lại ngay khi cuộc gọi đã mở; kết quả cuối báo bằng toast.
  setTimeout(() => (busy.value = false), 500)
  const res = await pending
  busy.value = false
  if (res.ok || res.reason === 'busy' || res.reason === 'hangup') return
  const key = MIC_ERRORS[res.reason] || OUTGOING_TOASTS[res.reason]
  const description = key ? t(key) : res.error || t('conversation.fbwebCall.callFailed')
  emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description })
}

// Tắt chuông chỉ trên trình duyệt này (fbwebCall.js, silenceFbwebCall): không gửi gì lên gateway.
function silence () {
  if (ring.value) silenceFbwebCall(ring.value)
}
</script>
