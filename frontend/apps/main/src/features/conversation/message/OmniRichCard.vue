<template>
  <!-- omnichannel: a structured message the bots turn into emoji lines (link,
       contact card, poll, location, todo, call, friend request, big video,
       undecryptable), drawn as a card like the Vetgo app -->
  <div class="flex items-start gap-3" :data-omni-rich="card.kind">
    <span
      class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
      :class="card.missed ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'"
    >
      <component :is="icon" :size="18" />
    </span>
    <div class="min-w-0 break-words">
      <div class="text-xs text-muted-foreground">{{ t(`conversation.omni.rich.${card.kind}`) }}</div>
      <div v-if="card.title" class="font-medium" :class="{ 'text-destructive': card.missed }">
        {{ card.title }}
      </div>
      <div v-if="card.pollAction" class="text-sm text-muted-foreground">{{ card.pollAction }}</div>
      <ul v-if="card.options?.length" class="mt-1 space-y-1">
        <li
          v-for="(option, i) in card.options"
          :key="i"
          class="rounded-md border border-border px-2 py-1 text-sm"
        >
          {{ option }}
        </li>
      </ul>
      <div v-for="(line, i) in card.lines" :key="i" class="text-sm text-muted-foreground">
        {{ line }}
      </div>
      <a
        v-if="safeUrl"
        :href="safeUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {{ t(richActionKey(card.kind)) }}
        <ExternalLink :size="12" />
      </a>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChartBar,
  Contact,
  ExternalLink,
  Link,
  MapPin,
  Phone,
  PhoneMissed,
  ShieldAlert,
  SquareCheck,
  UserPlus,
  Video
} from 'lucide-vue-next'
import { richActionKey } from '@main/utils/omnichannel.js'

const props = defineProps({
  // omni-core richCard(message): { kind, title, lines, url, pollAction, options, missed }
  card: { type: Object, required: true }
})

const { t } = useI18n()

const ICONS = {
  link: Link,
  contact: Contact,
  poll: ChartBar,
  location: MapPin,
  todo: SquareCheck,
  call: Phone,
  friend: UserPlus,
  video: Video,
  undecryptable: ShieldAlert
}

const icon = computed(() => (props.card.missed ? PhoneMissed : ICONS[props.card.kind] || Link))

// Only http(s) links become a button; the URL comes from the customer's message.
const safeUrl = computed(() => (/^https?:\/\//i.test(props.card.url || '') ? props.card.url : ''))
</script>
