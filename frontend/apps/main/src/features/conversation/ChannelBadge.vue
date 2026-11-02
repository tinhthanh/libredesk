<template>
  <!-- omnichannel: channel logo on the avatar's corner, like Messenger and Zalo do. -->
  <img
    v-if="icon"
    :src="icon.src"
    :alt="icon.label"
    :title="conversation.inbox_name"
    class="absolute rounded-full bg-background ring-2 ring-background object-contain pointer-events-none select-none"
    draggable="false"
  />
</template>

<script setup>
import { computed } from 'vue'
import { omniChannel } from '@main/utils/omnichannel.js'
import zalo from '@main/assets/channels/zalo.svg'
import zaloOA from '@main/assets/channels/zalo-oa.svg'
import messenger from '@main/assets/channels/messenger.svg'
import fanpage from '@main/assets/channels/fanpage.svg'

const props = defineProps({
  conversation: Object
})

// A personal Facebook account chats through Messenger; both Fanpage kinds are a Page.
const ICONS = {
  zalo: { src: zalo, label: 'Zalo' },
  'zalo-oa': { src: zaloOA, label: 'Zalo OA' },
  facebook: { src: messenger, label: 'Messenger' },
  fanpage: { src: fanpage, label: 'Fanpage' },
  'fanpage-web': { src: fanpage, label: 'Fanpage' }
}

const icon = computed(() => ICONS[omniChannel(props.conversation)])
</script>
