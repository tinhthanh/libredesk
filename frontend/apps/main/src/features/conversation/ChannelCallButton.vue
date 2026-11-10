<template>
  <!-- Gọi khách Zalo (omnichannel docs/plan-zalo-call.md): nút 📞 và thanh cuộc gọi trên đầu hội thoại. -->
  <div v-if="visible" class="flex items-center gap-1">
    <template v-if="isThisCall && call.state !== 'idle'">
      <span
        class="text-xs whitespace-nowrap px-2 py-1 rounded-md"
        :class="call.state === 'in_call' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-muted text-muted-foreground'"
        data-testid="call-status"
      >
        {{ statusText }}
      </span>
      <template v-if="active">
        <Button
          variant="ghost"
          class="w-11 h-11 md:w-8 md:h-8 p-0"
          :aria-label="call.muted ? t('conversation.call.unmute') : t('conversation.call.mute')"
          :disabled="call.state !== 'in_call'"
          @click="toggleMute"
        >
          <MicOff v-if="call.muted" class="w-4 h-4 text-destructive" />
          <Mic v-else class="w-4 h-4" />
        </Button>
        <Button
          variant="destructive"
          class="w-11 h-11 md:w-8 md:h-8 p-0"
          :aria-label="t('conversation.call.hangup')"
          @click="hangupCall"
        >
          <PhoneOff class="w-4 h-4" />
        </Button>
      </template>
      <Button
        v-else
        variant="ghost"
        class="w-11 h-11 md:w-8 md:h-8 p-0"
        :aria-label="t('globals.messages.close')"
        @click="dismissCall"
      >
        <X class="w-4 h-4" />
      </Button>
    </template>
    <Tooltip v-else>
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          class="w-11 h-11 md:w-8 md:h-8 p-0"
          :aria-label="t('conversation.call.start')"
          :disabled="active"
          @click="start"
        >
          <Phone class="w-4 h-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {{ active ? t('conversation.call.otherActive', { name: call.contactName }) : t('conversation.call.start') }}
      </TooltipContent>
    </Tooltip>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Mic, MicOff, Phone, PhoneOff, X } from 'lucide-vue-next'
import { Button } from '@shared-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared-ui/components/ui/tooltip'
import { useConversationStore } from '@main/stores/conversation'
import { useUserStore } from '@main/stores/user'
import { useEmitter } from '@main/composables/useEmitter'
import { EMITTER_EVENTS } from '@main/constants/emitterEvents.js'
import { omniChannel } from '@main/utils/omnichannel.js'
import {
  call,
  callActive,
  callFeature,
  ensureCallFeature,
  callStatusKey,
  dismissCall,
  formatCallDuration,
  hangupCall,
  startCall,
  toggleMute
} from '@main/utils/omnichannelCall.js'

const { t } = useI18n()
const conversationStore = useConversationStore()
const userStore = useUserStore()
const emitter = useEmitter()

const conversation = computed(() => conversationStore.current)
const eligible = computed(
  () => omniChannel(conversation.value) === 'zalo' && userStore.can('conversations:write') && !!window.RTCPeerConnection
)
const visible = computed(() => eligible.value && callFeature.enabled)
watch(
  eligible,
  (yes) => {
    if (yes) ensureCallFeature()
  },
  { immediate: true }
)
const isThisCall = computed(() => call.conversationUUID && call.conversationUUID === conversation.value?.uuid)
const active = computed(() => callActive())
const statusText = computed(() => {
  const label = t(callStatusKey(call.state, call.reason))
  return call.state === 'in_call' || (call.state === 'ended' && call.durationSecs > 0)
    ? `${label} · ${formatCallDuration(call.durationSecs)}`
    : label
})

const start = async () => {
  const conv = conversation.value
  if (!conv) return
  const err = await startCall(conv.uuid, conversationStore.currentContactName)
  if (!err) return
  emitter.emit(EMITTER_EVENTS.SHOW_TOAST, {
    variant: 'destructive',
    description: err === 'mic' ? t('conversation.call.micDenied') : err === 'error' ? t('conversation.call.failed') : err
  })
}
</script>
