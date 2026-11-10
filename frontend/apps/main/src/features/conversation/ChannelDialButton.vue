<template>
  <!-- SMS (omnichannel docs/plan-sms-call.md, P3): điện thoại chi nhánh quay số khách và thanh cuộc gọi
       trực tiếp. Các nút điều khiển điện thoại thật qua vglink; tiếng vẫn ở điện thoại. -->
  <div v-if="visible" class="flex items-center gap-1">
    <template v-if="live">
      <span
        class="text-xs whitespace-nowrap px-2 py-1 rounded-md"
        :class="live.state === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-muted text-muted-foreground'"
        data-testid="branch-call-status"
      >
        {{ statusText }}
      </span>
      <Button
        v-if="live.incoming && live.state === 'ringing'"
        class="h-11 md:h-8 px-2 bg-green-600 hover:bg-green-700 text-white"
        :disabled="busy"
        @click="act('answer')"
      >
        <Phone class="w-4 h-4 md:mr-1" /><span class="hidden md:inline">{{ t('conversation.dial.answer') }}</span>
      </Button>
      <Tooltip v-if="live.state === 'active'">
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            class="w-11 h-11 md:w-8 md:h-8 p-0"
            :aria-label="speaker ? t('conversation.dial.earpiece') : t('conversation.dial.speaker')"
            :disabled="busy"
            @click="act(speaker ? 'earpiece' : 'speaker')"
          >
            <Volume2 v-if="speaker" class="w-4 h-4" />
            <Volume1 v-else class="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ speaker ? t('conversation.dial.earpiece') : t('conversation.dial.speaker') }}</TooltipContent>
      </Tooltip>
      <Button
        variant="destructive"
        class="w-11 h-11 md:w-8 md:h-8 p-0"
        :aria-label="live.incoming && live.state === 'ringing' ? t('conversation.dial.decline') : t('conversation.dial.hangup')"
        :disabled="busy"
        data-testid="branch-hangup"
        @click="act('decline')"
      >
        <PhoneOff class="w-4 h-4" />
      </Button>
    </template>
    <span
      v-else-if="dialing"
      class="text-xs whitespace-nowrap px-2 py-1 rounded-md bg-muted text-muted-foreground"
      data-testid="branch-call-status"
    >
      {{ t('conversation.dial.dialing') }}
    </span>
    <Tooltip v-else>
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          class="w-11 h-11 md:w-8 md:h-8 p-0"
          :aria-label="t('conversation.dial.start')"
          :disabled="busy"
          data-testid="branch-dial"
          @click="dial"
        >
          <PhoneOutgoing class="w-4 h-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ t('conversation.dial.start') }}</TooltipContent>
    </Tooltip>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Phone, PhoneOff, PhoneOutgoing, Volume1, Volume2 } from 'lucide-vue-next'
import { Button } from '@shared-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared-ui/components/ui/tooltip'
import api from '@main/api'
import { useConversationStore } from '@main/stores/conversation'
import { useUserStore } from '@main/stores/user'
import { useEmitter } from '@main/composables/useEmitter'
import { EMITTER_EVENTS } from '@main/constants/emitterEvents.js'
import { omniChannel } from '@main/utils/omnichannel.js'
import {
  DIAL_WAIT_MS,
  branchCallOf,
  branchCalls,
  callFeature,
  ensureCallFeature,
  formatCallDuration,
  secondsSince,
  smsAccountOf
} from '@main/utils/omnichannelCall.js'

const { t } = useI18n()
const conversationStore = useConversationStore()
const userStore = useUserStore()
const emitter = useEmitter()
const busy = ref(false)
// Loa ngoài: điện thoại không báo trạng thái loa, nên nhớ lần bấm gần nhất trong cuộc gọi này.
const speakerOf = ref({})
const now = ref(Date.now())
let tick = null
onMounted(() => {
  tick = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => clearInterval(tick))

const conversation = computed(() => conversationStore.current)
const account = computed(() => smsAccountOf(conversation.value))
const eligible = computed(() => omniChannel(conversation.value) === 'sms' && userStore.can('conversations:write'))
const visible = computed(() => eligible.value && callFeature.smsAccounts.includes(account.value))
watch(
  () => [eligible.value, conversation.value?.uuid],
  ([yes]) => {
    if (yes) ensureCallFeature()
  },
  { immediate: true }
)

const live = computed(() => branchCallOf(conversation.value?.uuid))
const dialing = computed(() => {
  const at = branchCalls.dialing[conversation.value?.uuid]
  return !!at && now.value - at < DIAL_WAIT_MS
})
const speaker = computed(() => !!(live.value && speakerOf.value[live.value.call_id]))
const statusText = computed(() => {
  const c = live.value
  if (!c) return ''
  if (c.state === 'ringing') return c.incoming ? t('conversation.dial.incoming') : t('conversation.dial.dialing')
  const secs = formatCallDuration(secondsSince(c.active_since || c.since, now.value))
  return `${c.incoming ? t('conversation.dial.talking') : t('conversation.dial.calling')} · ${secs}`
})

const fail = (error) =>
  emitter.emit(EMITTER_EVENTS.SHOW_TOAST, {
    variant: 'destructive',
    description: error?.response?.data?.error || t('conversation.dial.failed')
  })

const dial = async () => {
  const conv = conversation.value
  if (!conv || busy.value) return
  busy.value = true
  try {
    await api.dialBranchPhone(conv.uuid)
    branchCalls.dialing[conv.uuid] = Date.now()
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}

const act = async (action) => {
  const c = live.value
  if (!c || busy.value) return
  busy.value = true
  try {
    await api.branchCallAction(c.account, c.call_id, action)
    if (action === 'speaker' || action === 'earpiece') {
      speakerOf.value = { ...speakerOf.value, [c.call_id]: action === 'speaker' }
    }
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}
</script>
