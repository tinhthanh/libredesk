<template>
  <!-- Khách đang gọi điện thoại chi nhánh (omnichannel docs/plan-sms-call.md, P3; gateway phonecalls.go). -->
  <div
    v-for="c in calls"
    :key="c.channel + c.account + c.call_id"
    class="flex items-center gap-3 px-4 py-2 text-sm bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100 border-b"
    role="status"
    data-testid="ringing-banner"
  >
    <PhoneIncoming class="w-4 h-4 shrink-0 animate-pulse" />
    <span class="truncate">
      {{ t('conversation.ringing.text', { who: who(c), branch: c.label }) }}
    </span>
    <Button v-if="c.conversation_uuid" size="sm" variant="outline" class="ml-auto h-7" @click="open(c)">
      {{ t('conversation.ringing.open') }}
    </Button>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { PhoneIncoming } from 'lucide-vue-next'
import { Button } from '@shared-ui/components/ui/button'
import { playNotificationSound } from '@shared-ui/composables/useNotificationSound'
import api from '@main/api'
import { useUserStore } from '@main/stores/user'

const POLL_MS = 3000
// Gateway chưa có kênh SMS (404) hoặc lỗi: hỏi lại thưa hơn.
const IDLE_MS = 5 * 60 * 1000

const { t } = useI18n()
const router = useRouter()
const userStore = useUserStore()
const calls = ref([])
const announced = new Set()
let timer = null
let stopped = false

const who = (c) => (c.name && c.name !== c.number ? `${c.name} (${c.number})` : c.number || t('conversation.ringing.hidden'))

const open = (c) => router.push({ name: 'inbox-conversation', params: { type: 'all', uuid: c.conversation_uuid } })

async function poll () {
  let next = POLL_MS
  try {
    if (userStore.can('messages:read')) {
      const { data } = await api.getRingingCalls()
      const list = Array.isArray(data?.calls) ? data.calls : []
      for (const c of list) {
        const key = c.channel + c.account + c.call_id
        if (!announced.has(key)) {
          announced.add(key)
          playNotificationSound()
        }
      }
      if (announced.size > 200) announced.clear()
      calls.value = list
    }
  } catch {
    calls.value = []
    next = IDLE_MS
  }
  if (!stopped) timer = setTimeout(poll, next)
}

onMounted(poll)
onBeforeUnmount(() => {
  stopped = true
  clearTimeout(timer)
})
</script>
