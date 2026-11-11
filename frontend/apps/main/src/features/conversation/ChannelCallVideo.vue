<template>
  <!-- Gọi video Zalo (omnichannel docs/plan-zalo-call.md, mục "Gọi video"): cửa sổ nổi, giữ nguyên khi đổi hội thoại. -->
  <div
    v-if="visible"
    class="absolute bottom-24 right-4 z-30 rounded-lg border bg-background shadow-lg overflow-hidden"
    :class="collapsed ? 'w-56' : 'w-72'"
    data-testid="call-video"
  >
    <div class="flex items-center justify-between gap-2 px-2 py-1 text-xs border-b">
      <span class="truncate font-medium">{{ call.contactName }}</span>
      <span class="text-muted-foreground whitespace-nowrap">{{ statusText }}</span>
      <Button variant="ghost" class="h-6 w-6 p-0" :aria-label="collapsed ? t('globals.terms.expand') : t('globals.terms.collapse')" @click="collapsed = !collapsed">
        <component :is="collapsed ? Maximize2 : Minimize2" class="w-3 h-3" />
      </Button>
    </div>
    <div v-show="!collapsed" class="relative bg-black aspect-[3/4]">
      <video ref="remoteEl" class="w-full h-full object-contain" autoplay playsinline />
      <div
        v-if="!hasRemote"
        class="absolute inset-0 flex items-center justify-center text-xs text-white/80 px-4 text-center"
      >
        {{ t('conversation.call.waitingVideo') }}
      </div>
      <video
        ref="localEl"
        class="absolute bottom-2 right-2 w-20 rounded border border-white/40 bg-black object-cover"
        :class="{ 'opacity-30': call.cameraOff }"
        autoplay
        playsinline
        muted
      />
    </div>
    <div class="flex items-center justify-center gap-2 p-2">
      <Button
        variant="outline"
        class="h-8 w-8 p-0"
        :aria-label="call.muted ? t('conversation.call.unmute') : t('conversation.call.mute')"
        @click="toggleMute"
      >
        <MicOff v-if="call.muted" class="w-4 h-4 text-destructive" />
        <Mic v-else class="w-4 h-4" />
      </Button>
      <Button
        variant="outline"
        class="h-8 w-8 p-0"
        :aria-label="call.cameraOff ? t('conversation.call.cameraOn') : t('conversation.call.cameraOff')"
        @click="onToggleCamera"
      >
        <VideoOff v-if="call.cameraOff" class="w-4 h-4 text-destructive" />
        <Video v-else class="w-4 h-4" />
      </Button>
      <Button variant="destructive" class="h-8 w-8 p-0" :aria-label="t('conversation.call.hangup')" @click="hangupCall">
        <PhoneOff class="w-4 h-4" />
      </Button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Maximize2, Mic, MicOff, Minimize2, PhoneOff, Video, VideoOff } from 'lucide-vue-next'
import { Button } from '@shared-ui/components/ui/button'
import { useEmitter } from '@main/composables/useEmitter'
import { EMITTER_EVENTS } from '@main/constants/emitterEvents.js'
import {
  call,
  callActive,
  callStatusKey,
  callVideo,
  formatCallDuration,
  hangupCall,
  toggleCamera,
  toggleMute
} from '@main/utils/omnichannelCall.js'

const { t } = useI18n()
const collapsed = ref(false)
const remoteEl = ref(null)
const localEl = ref(null)

const visible = computed(() => call.video && callActive())
const emitter = useEmitter()
const onToggleCamera = async () => {
  const err = await toggleCamera(t('conversation.call.cameraOffCard'))
  if (err) emitter.emit(EMITTER_EVENTS.SHOW_TOAST, { variant: 'destructive', description: t('conversation.call.cameraDenied') })
}
const hasRemote = computed(() => !!callVideo.remote.value)
const statusText = computed(() => {
  const label = t(callStatusKey(call.state, call.reason))
  return call.state === 'in_call' ? `${label} · ${formatCallDuration(call.durationSecs)}` : label
})

// Gắn luồng vào thẻ <video> mỗi khi luồng hoặc cửa sổ thay đổi (cửa sổ dựng lại khi đổi hội thoại).
watch(
  [() => callVideo.remote.value, () => callVideo.local.value, visible, collapsed],
  async () => {
    await nextTick()
    if (remoteEl.value && remoteEl.value.srcObject !== callVideo.remote.value) {
      remoteEl.value.srcObject = callVideo.remote.value
    }
    if (localEl.value && localEl.value.srcObject !== callVideo.local.value) {
      localEl.value.srcObject = callVideo.local.value
    }
  },
  { immediate: true }
)
</script>
