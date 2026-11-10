<template>
  <!-- SMS (omnichannel docs/plan-sms-call.md, P3): điện thoại chi nhánh quay số khách; nhân viên nói trên điện thoại. -->
  <Tooltip v-if="visible">
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
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PhoneOutgoing } from 'lucide-vue-next'
import { Button } from '@shared-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared-ui/components/ui/tooltip'
import api from '@main/api'
import { useConversationStore } from '@main/stores/conversation'
import { useUserStore } from '@main/stores/user'
import { useEmitter } from '@main/composables/useEmitter'
import { EMITTER_EVENTS } from '@main/constants/emitterEvents.js'
import { omniChannel } from '@main/utils/omnichannel.js'
import { callFeature, ensureCallFeature, smsAccountOf } from '@main/utils/omnichannelCall.js'

const { t } = useI18n()
const conversationStore = useConversationStore()
const userStore = useUserStore()
const emitter = useEmitter()
const busy = ref(false)

const conversation = computed(() => conversationStore.current)
const eligible = computed(() => omniChannel(conversation.value) === 'sms' && userStore.can('conversations:write'))
const visible = computed(() => eligible.value && callFeature.smsAccounts.includes(smsAccountOf(conversation.value)))
watch(
  () => [eligible.value, conversation.value?.uuid],
  ([yes]) => {
    if (yes) ensureCallFeature()
  },
  { immediate: true }
)

const dial = async () => {
  const conv = conversation.value
  if (!conv || busy.value) return
  busy.value = true
  try {
    await api.dialBranchPhone(conv.uuid)
    emitter.emit(EMITTER_EVENTS.SHOW_TOAST, {
      description: t('conversation.dial.started', { branch: smsAccountOf(conv) })
    })
  } catch (error) {
    emitter.emit(EMITTER_EVENTS.SHOW_TOAST, {
      variant: 'destructive',
      description: error?.response?.data?.error || t('conversation.dial.failed')
    })
  } finally {
    busy.value = false
  }
}
</script>
