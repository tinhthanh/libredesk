<template>
  <!-- omnichannel (D19): Telegram alerts of the gateway, set here instead of .env. -->
  <AdminSplitLayout>
    <template #content>
      <LoadingOverlay :loading="loading && !form" reserve-height>
        <div v-if="form" class="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{{ t('admin.channelAlerts.telegram') }}</CardTitle>
              <CardDescription>{{ t('admin.channelAlerts.telegramHint') }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <label class="flex items-center gap-3 text-sm font-medium">
                <Switch v-model:checked="form.enabled" />
                {{ t('admin.channelAlerts.enabled') }}
              </label>
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="tg-token">{{ t('admin.channelAlerts.token') }}</label>
                  <Input
                    id="tg-token"
                    v-model="form.token"
                    type="password"
                    autocomplete="off"
                    :placeholder="saved.telegram_token_set ? t('admin.channelAlerts.tokenSaved') : '123456:ABC...'"
                  />
                  <button
                    v-if="saved.telegram_token_set"
                    type="button"
                    class="text-xs text-destructive underline"
                    @click="clearToken"
                  >
                    {{ t('admin.channelAlerts.clearToken') }}
                  </button>
                </div>
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="tg-chat">{{ t('admin.channelAlerts.chat') }}</label>
                  <Input id="tg-chat" v-model="form.telegram_chat_id" placeholder="-1001234567890" />
                </div>
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="tg-link">{{ t('admin.channelAlerts.link') }}</label>
                  <Input id="tg-link" v-model="form.link" placeholder="http://localhost:9000/admin/channel-accounts" />
                </div>
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="tg-after">{{ t('admin.channelAlerts.offlineAfter') }}</label>
                  <Input id="tg-after" v-model.number="form.offline_after_min" type="number" min="1" max="1440" />
                  <p class="text-xs text-muted-foreground">{{ t('admin.channelAlerts.offlineAfterHint') }}</p>
                </div>
              </div>
              <div class="flex gap-2">
                <Button :disabled="saving" @click="save()">{{ t('globals.messages.save') }}</Button>
                <Button variant="outline" :disabled="saving || !saved.telegram_token_set" @click="sendTest">
                  {{ t('admin.channelAlerts.test') }}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{{ t('admin.channelAlerts.mute') }}</CardTitle>
              <CardDescription>{{ t('admin.channelAlerts.muteHint') }}</CardDescription>
            </CardHeader>
            <CardContent>
              <p v-if="!accounts.length" class="text-sm text-muted-foreground">{{ t('admin.channelAccounts.empty') }}</p>
              <ul class="divide-y">
                <li v-for="a in accounts" :key="a.key" class="flex flex-wrap items-center gap-3 py-2">
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{{ a.label }} - {{ a.name }}</div>
                    <div class="text-xs" :class="muteOf(a.key) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'">
                      {{ muteOf(a.key) ? muteLabel(muteOf(a.key).until, t, locale) : t('admin.channelAlerts.notMuted') }}
                    </div>
                  </div>
                  <template v-if="muteOf(a.key)">
                    <Button size="sm" variant="outline" @click="mute(a.key, 0)">{{ t('admin.channelAlerts.unmute') }}</Button>
                  </template>
                  <template v-else>
                    <select v-model="choice[a.key]" class="h-8 rounded-md border bg-background px-2 text-sm">
                      <option v-for="o in MUTE_OPTIONS" :key="o.minutes" :value="o.minutes">{{ t(o.key) }}</option>
                    </select>
                    <Button size="sm" variant="outline" @click="mute(a.key, choice[a.key] ?? 60)">
                      {{ t('admin.channelAlerts.muteAction') }}
                    </Button>
                  </template>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </LoadingOverlay>
    </template>
    <template #help>
      <p>{{ t('admin.channelAlerts.help') }}</p>
    </template>
  </AdminSplitLayout>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AdminSplitLayout from '@/layouts/admin/AdminSplitLayout.vue'
import LoadingOverlay from '@main/components/layout/LoadingOverlay.vue'
import { Button } from '@shared-ui/components/ui/button/index.js'
import { Input } from '@shared-ui/components/ui/input/index.js'
import { Switch } from '@shared-ui/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared-ui/components/ui/card/index.js'
import { useEmitter } from '../../../composables/useEmitter.js'
import { EMITTER_EVENTS } from '../../../constants/emitterEvents.js'
import { errorMessage, muteLabel } from '../../../features/admin/channel-accounts/channelAccounts.js'
import api from '../../../api/index.js'

const MUTE_OPTIONS = [
  { minutes: 60, key: 'admin.channelAlerts.mute1h' },
  { minutes: 8 * 60, key: 'admin.channelAlerts.mute8h' },
  { minutes: 24 * 60, key: 'admin.channelAlerts.mute24h' },
  { minutes: -1, key: 'admin.channelAlerts.muteForever' }
]

const { t, locale } = useI18n()
const emitter = useEmitter()
const loading = ref(false)
const saving = ref(false)
const saved = ref({})
const form = ref(null)
const accounts = ref([])
const choice = ref({})

function toast (description, variant) {
  emitter.emit(EMITTER_EVENTS.SHOW_TOAST, variant ? { variant, description } : { description })
}

function apply (data) {
  saved.value = data
  form.value = {
    enabled: data.enabled,
    telegram_chat_id: data.telegram_chat_id || '',
    link: data.link || '',
    offline_after_min: data.offline_after_min || 10,
    token: ''
  }
}

function muteOf (key) {
  return (saved.value.muted || []).find((m) => m.key === key)
}

async function load () {
  loading.value = true
  try {
    const [settings, list] = await Promise.all([api.getAlertSettings(), api.getChannelAccounts()])
    apply(settings.data)
    accounts.value = (list.data || []).flatMap((c) =>
      (c.accounts || []).map((a) => ({ key: `${c.channel}/${a.name}`, label: c.label, name: a.name }))
    )
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  } finally {
    loading.value = false
  }
}

async function save (extra = {}) {
  saving.value = true
  try {
    const { token, ...rest } = form.value
    const body = { ...rest, ...extra }
    if (token.trim()) body.telegram_token = token.trim()
    const resp = await api.saveAlertSettings(body)
    apply(resp.data)
    toast(t('admin.channelAlerts.saved'))
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  } finally {
    saving.value = false
  }
}

function clearToken () {
  save({ clear_token: true, enabled: false })
}

async function sendTest () {
  saving.value = true
  try {
    await api.testAlert()
    toast(t('admin.channelAlerts.testSent'))
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  } finally {
    saving.value = false
  }
}

async function mute (key, minutes) {
  try {
    const resp = await api.muteAlerts(key, minutes)
    saved.value = { ...saved.value, muted: resp.data.muted }
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  }
}

onMounted(load)
</script>
