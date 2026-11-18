<template>
  <!-- Fanpage Web (omnichannel docs/plan-fbweb-call.md, P3): camera của khách khi khách bật camera trong cuộc
       gọi đang nghe trên Libredesk. Nhân viên chỉ gửi tiếng. Cửa sổ nổi, giữ nguyên khi đổi hội thoại. -->
  <div
    v-if="visible"
    class="absolute bottom-24 right-4 z-30 w-56 rounded-lg border bg-background shadow-lg overflow-hidden"
    data-testid="fbweb-call-video"
  >
    <div class="px-2 py-1 text-xs border-b truncate">{{ t('conversation.fbwebCall.camera') }}</div>
    <video ref="videoEl" class="w-full aspect-[3/4] bg-black object-contain" autoplay playsinline muted />
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fbwebCall, fbwebVideo } from '@main/utils/fbwebCall.js'

const { t } = useI18n()
const videoEl = ref(null)
const visible = computed(() => fbwebCall.state === 'in_call' && fbwebCall.remoteVideo)

watch(
  visible,
  async (on) => {
    if (!on) return
    await nextTick()
    if (videoEl.value) videoEl.value.srcObject = fbwebVideo.remote.value
  },
  { immediate: true }
)
</script>
