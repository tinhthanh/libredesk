<template>
  <!-- omnichannel: a gateway note (recall, edit, reaction, group, friend, system,
       call, failed send) as a compact line, like the Vetgo app -->
  <div class="flex justify-center px-4" :data-omni-event="note.kind">
    <div
      class="flex max-w-[85%] items-start gap-2 rounded-xl border px-3 py-1.5 text-sm"
      :class="tone"
    >
      <component :is="icon" :size="14" class="mt-0.5 flex-shrink-0" />
      <div class="min-w-0 break-words">
        <div class="font-medium">
          {{ note.title }}
          <span v-if="note.sender" class="font-normal text-muted-foreground">· {{ note.sender }}</span>
        </div>
        <div v-for="(line, i) in note.body" :key="i" class="text-muted-foreground">
          {{ line }}
        </div>
        <BubbleAttachmentPreview
          v-if="attachments.length"
          :attachments="attachments"
          class="mt-1"
        />
      </div>
      <Tooltip>
        <TooltipTrigger>
          <span class="mt-0.5 flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Lock :size="10" />
            {{ format(message.created_at, 'h:mm a') }}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ t('conversation.omni.event.privateNote') }} · {{ format(message.created_at, 'dd/MM/yyyy HH:mm') }}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { format } from 'date-fns'
import {
  Info,
  Lock,
  Pencil,
  Phone,
  PhoneMissed,
  Smile,
  TriangleAlert,
  Undo2,
  UserPlus,
  Users
} from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared-ui/components/ui/tooltip'
import BubbleAttachmentPreview from '@main/features/conversation/message/attachment/BubbleAttachmentPreview.vue'

const props = defineProps({
  message: { type: Object, required: true },
  // omni-core eventNote(message): { kind, title, sender, body, missed }
  note: { type: Object, required: true }
})

const { t } = useI18n()

const ICONS = {
  recall: Undo2,
  edit: Pencil,
  reaction: Smile,
  group: Users,
  friend: UserPlus,
  system: Info,
  call: Phone,
  failed: TriangleAlert
}

const icon = computed(() => (props.note.missed ? PhoneMissed : ICONS[props.note.kind] || Info))

const tone = computed(() => {
  if (props.note.missed || props.note.kind === 'failed') {
    return 'border-destructive/30 bg-destructive/5 text-destructive'
  }
  if (props.note.kind === 'call') return 'border-green-600/30 bg-green-600/5 text-green-700 dark:text-green-400'
  return 'border-border bg-muted/40 text-foreground'
})

const attachments = computed(() =>
  (props.message.attachments || []).filter((a) => a.disposition !== 'inline')
)
</script>
