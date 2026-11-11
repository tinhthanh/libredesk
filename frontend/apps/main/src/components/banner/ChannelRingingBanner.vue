<template>
  <!-- Khách đang gọi điện thoại chi nhánh (omnichannel docs/plan-sms-call.md, P3; gateway phonecalls.go). -->
  <div
    v-for="c in ringing"
    :key="c.account + c.call_id"
    class="flex flex-wrap items-center gap-2 px-4 py-2 text-sm bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100 border-b"
    role="status"
    data-testid="ringing-banner"
  >
    <PhoneIncoming class="w-4 h-4 shrink-0 animate-pulse" />
    <span class="truncate mr-auto">
      {{ t('conversation.ringing.text', { who: who(c), branch: c.label }) }}
    </span>
    <template v-if="canControl(c)">
      <Button size="sm" class="h-7 bg-green-600 hover:bg-green-700 text-white" :disabled="busy" @click="act(c, 'answer')">
        <Phone class="w-3.5 h-3.5 mr-1" />{{ t('conversation.dial.answer') }}
      </Button>
      <Button size="sm" variant="destructive" class="h-7" :disabled="busy" @click="act(c, 'decline')">
        <PhoneOff class="w-3.5 h-3.5 mr-1" />{{ t('conversation.dial.decline') }}
      </Button>
    </template>
    <Button v-if="c.conversation_uuid" size="sm" variant="outline" class="h-7" @click="open(c)">
      {{ t('conversation.ringing.open') }}
    </Button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Phone, PhoneIncoming, PhoneOff } from 'lucide-vue-next'
import { Button } from '@shared-ui/components/ui/button'
import { playNotificationSound } from '@shared-ui/composables/useNotificationSound'
import api from '@main/api'
import { useUserStore } from '@main/stores/user'
import { useEmitter } from '@main/composables/useEmitter'
import { EMITTER_EVENTS } from '@main/constants/emitterEvents.js'
import { branchCallAction, branchCalls, callFeature, ensureCallFeature, pruneDialing } from '@main/utils/omnichannelCall.js'
import { audioWanted, branchAudio, prepareAudio, stopBranchAudio } from '@main/utils/branchCallAudio.js'

const POLL_MS = 3000
// Gateway chưa có kênh SMS (404): hỏi lại thưa hơn. Lỗi khác (mạng chập chờn): thử lại sớm.
const IDLE_MS = 5 * 60 * 1000
const RETRY_MS = 10 * 1000

const { t } = useI18n()
const router = useRouter()
const userStore = useUserStore()
const emitter = useEmitter()
const busy = ref(false)
const announced = new Set()
let timer = null
let stopped = false

// Thanh này chỉ cho khách gọi tới đang đổ chuông; cuộc gọi đang nói hiện trong hội thoại.
const ringing = computed(() => branchCalls.list.filter((c) => c.incoming && c.state === 'ringing'))

const who = (c) => (c.name && c.name !== c.number ? `${c.name} (${c.number})` : c.number || t('conversation.ringing.hidden'))
const canControl = (c) => userStore.can('conversations:write') && callFeature.smsAccounts.includes(c.account)

const open = (c) => router.push({ name: 'inbox-conversation', params: { type: 'all', uuid: c.conversation_uuid } })

async function act (c, action) {
  busy.value = true
  if (action === 'answer' && c.conversation_uuid) {
    // Nghe máy trên máy tính: thanh cuộc gọi trong hội thoại tự chuyển tiếng sang đây (P5).
    prepareAudio()
    audioWanted[c.conversation_uuid] = Date.now()
  }
  const { ok, error } = await branchCallAction(c, action)
  busy.value = false
  if (ok) {
    if (action === 'answer' && c.conversation_uuid) open(c)
    return
  }
  emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description: error || t('conversation.dial.failed') })
}

async function poll () {
  let next = POLL_MS
  try {
    if (userStore.can('messages:read')) {
      const { data } = await api.getRingingCalls()
      const list = Array.isArray(data?.calls) ? data.calls : []
      const keys = new Set()
      for (const c of list) {
        const key = c.account + c.call_id
        keys.add(key)
        if (c.incoming && c.state === 'ringing' && !announced.has(key)) {
          announced.add(key)
          ensureCallFeature()
          playNotificationSound()
        }
        if (c.conversation_uuid) delete branchCalls.dialing[c.conversation_uuid]
      }
      // Chỉ nhớ các cuộc gọi còn trong danh sách: cuộc đang đổ chuông không báo lại.
      for (const k of announced) if (!keys.has(k)) announced.delete(k)
      pruneDialing()
      branchCalls.list = list
      // Cuộc gọi đang nghe trên máy tính đã xong: tắt micro, đóng âm thanh (chỉ khi hỏi được danh sách).
      if (branchAudio.key && !list.some((c) => `${c.account}:${c.call_id}` === branchAudio.key)) stopBranchAudio()
    }
  } catch (error) {
    branchCalls.list = []
    next = error?.response?.status === 404 ? IDLE_MS : RETRY_MS
  }
  if (!stopped) timer = setTimeout(poll, next)
}

onMounted(poll)
onBeforeUnmount(() => {
  stopped = true
  clearTimeout(timer)
})
</script>
