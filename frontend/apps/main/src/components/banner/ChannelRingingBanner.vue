<template>
  <!-- Khách đang gọi điện thoại chi nhánh (omnichannel docs/plan-sms-call.md, P3; gateway phonecalls.go),
       hoặc gọi Trang Fanpage Web qua Messenger (docs/plan-fbweb-call.md, P3; nghe máy bằng WebRTC). -->
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
      <!-- Điện thoại qua Wi-Fi: tiếng không sang máy tính được, chỉ báo có cuộc gọi, không cho nghe ở đây. -->
      <span
        v-if="needsCable(c)"
        class="text-xs px-2 py-1 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
        :title="t('conversation.dial.needsCable')"
        data-testid="ringing-needs-cable"
      >
        {{ t('conversation.dial.needsCableShort') }}
      </span>
      <Button
        v-else
        size="sm"
        class="h-7 bg-green-600 hover:bg-green-700 text-white"
        :disabled="busy || (isFbwebCall(c) && fbwebCall.state !== 'idle')"
        @click="act(c, 'answer')"
      >
        <Phone class="w-3.5 h-3.5 mr-1" />{{ t('conversation.dial.answer') }}
      </Button>
      <!-- Fanpage Web: chỉ tắt chuông trên trình duyệt này, nhân viên khác vẫn đổ chuông; khách vẫn nghe chuông tới khi Facebook thôi. -->
      <Button
        size="sm"
        variant="destructive"
        class="h-7"
        :disabled="busy"
        :title="isFbwebCall(c) ? t('conversation.fbwebCall.silenceHint') : undefined"
        @click="act(c, 'decline')"
      >
        <BellOff v-if="isFbwebCall(c)" class="w-3.5 h-3.5 mr-1" />
        <PhoneOff v-else class="w-3.5 h-3.5 mr-1" />
        {{ isFbwebCall(c) ? t('conversation.fbwebCall.silence') : t('conversation.dial.decline') }}
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
import { BellOff, Phone, PhoneIncoming, PhoneOff } from 'lucide-vue-next'
import { Button } from '@shared-ui/components/ui/button'
import { playNotificationSound } from '@shared-ui/composables/useNotificationSound'
import api from '@main/api'
import { useUserStore } from '@main/stores/user'
import { useEmitter } from '@main/composables/useEmitter'
import { EMITTER_EVENTS } from '@main/constants/emitterEvents.js'
import { branchCallAction, branchCalls, callFeature, ensureCallFeature, pruneDialing } from '@main/utils/omnichannelCall.js'
import { audioWanted, branchAudio, needsCable, readyForCall, releaseUnusedMic, stopBranchAudio } from '@main/utils/branchCallAudio.js'
import { answerFbwebCall, fbwebCall, fbwebSupported, isFbwebCall, isFbwebSilenced, pruneFbwebSilenced, silenceFbwebCall, syncFbwebCall } from '@main/utils/fbwebCall.js'
import { later } from '@main/utils/backgroundTimer.js'

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
// Hẹn lần hỏi kế: tab ẩn thì hẹn trong Web Worker (backgroundTimer.js), vì Chrome hãm setTimeout
// của tab chạy nền còn mỗi phút một lần và lỡ cuộc gọi Facebook (đổ chuông khoảng 60 giây).
let cancelTimer = null
let dueAt = 0
let polling = false
let stopped = false

function schedule (ms) {
  cancelTimer?.()
  cancelTimer = stopped ? null : later(poll, ms)
  dueAt = Date.now() + ms
}

// Tab vừa ẩn (hay hiện lại): hẹn lại lần hỏi đang chờ bằng loại hẹn giờ hợp với trạng thái mới.
function onVisibility () {
  if (!polling && cancelTimer) schedule(Math.max(0, dueAt - Date.now()))
}

// Thanh này chỉ cho khách gọi tới đang đổ chuông; cuộc gọi đang nói hiện trong hội thoại.
// Cuộc gọi Fanpage Web đã tắt chuông trên trình duyệt này thì ẩn (nhân viên khác vẫn thấy).
const ringing = computed(() => branchCalls.list.filter((c) => c.incoming && c.state === 'ringing' && !isFbwebSilenced(c)))

// Fanpage Web: number là id Facebook của khách, chỉ hiện tên.
const who = (c) => {
  if (isFbwebCall(c)) return c.name || t('conversation.fbwebCall.customer')
  return c.name && c.name !== c.number ? `${c.name} (${c.number})` : c.number || t('conversation.ringing.hidden')
}
const canControl = (c) => {
  if (!userStore.can('conversations:write')) return false
  if (isFbwebCall(c)) return callFeature.fbwebAccounts.includes(c.account) && fbwebSupported()
  return callFeature.smsAccounts.includes(c.account)
}

const open = (c) => router.push({ name: 'inbox-conversation', params: { type: 'all', uuid: c.conversation_uuid } })

const MIC_ERRORS = { mic: 'conversation.call.micDenied', insecure: 'conversation.dial.audioInsecure' }

async function actFbweb (c, action) {
  if (action !== 'answer') {
    silenceFbwebCall(c)
    return
  }
  busy.value = true
  const res = await answerFbwebCall(c)
  busy.value = false
  if (res.ok) {
    if (action === 'answer' && c.conversation_uuid) open(c)
    return
  }
  if (res.reason === 'busy') return
  const description = MIC_ERRORS[res.reason] ? t(MIC_ERRORS[res.reason]) : res.error || t('conversation.fbwebCall.failed')
  emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description })
}

async function act (c, action) {
  if (isFbwebCall(c)) return actFbweb(c, action)
  if (action === 'answer' && needsCable(c)) {
    emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description: t('conversation.dial.needsCable') })
    return
  }
  busy.value = true
  if (action === 'answer' && c.conversation_uuid) {
    // Nghe máy trên máy tính (P5): micro trước, điện thoại bắt máy sau. Không có micro thì không bắt
    // máy (khách nghe máy mà nhân viên không nói được); vẫn nghe được bằng điện thoại ở chi nhánh.
    const why = await readyForCall()
    if (why) {
      busy.value = false
      emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description: t(MIC_ERRORS[why]) })
      return
    }
    audioWanted[c.conversation_uuid] = Date.now()
  }
  const { ok, error } = await branchCallAction(c, action)
  busy.value = false
  if (ok) {
    if (action === 'answer' && c.conversation_uuid) open(c)
    return
  }
  if (action === 'answer') {
    delete audioWanted[c.conversation_uuid]
    releaseUnusedMic()
  }
  emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description: error || t('conversation.dial.failed') })
}

async function poll () {
  cancelTimer = null
  polling = true
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
      pruneFbwebSilenced(list)
      syncFbwebCall(list)
      // Cuộc gọi đang nghe trên máy tính đã xong: tắt micro, đóng âm thanh (chỉ khi hỏi được danh sách).
      if (branchAudio.key && !list.some((c) => `${c.account}:${c.call_id}` === branchAudio.key)) stopBranchAudio()
    }
  } catch (error) {
    branchCalls.list = []
    next = error?.response?.status === 404 ? IDLE_MS : RETRY_MS
  }
  polling = false
  if (!stopped) schedule(next)
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  poll()
})
onBeforeUnmount(() => {
  stopped = true
  document.removeEventListener('visibilitychange', onVisibility)
  cancelTimer?.()
  cancelTimer = null
})
</script>
