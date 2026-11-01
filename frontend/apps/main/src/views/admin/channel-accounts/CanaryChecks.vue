<template>
  <!-- omnichannel (D19): daily canary results, run-now and its settings. The canary
       itself runs on the server (cron); the gateway only stores reports and requests. -->
  <AdminSplitLayout>
    <template #content>
      <LoadingOverlay :loading="loading && !data" reserve-height>
        <div v-if="data" class="space-y-6">
          <Card>
            <CardHeader class="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{{ t('admin.canary.latest') }}</CardTitle>
                <CardDescription>{{ t('admin.canary.latestHint') }}</CardDescription>
              </div>
              <div class="flex flex-wrap justify-end gap-2">
                <Button v-for="m in RUN_MODES" :key="m.mode" size="sm" :variant="m.mode === 'full' ? 'default' : 'outline'"
                        :disabled="busy" @click="run(m.mode)">
                  {{ t(m.key) }}
                </Button>
              </div>
            </CardHeader>
            <CardContent class="space-y-3 text-sm">
              <div v-if="status.pending || status.running" class="flex items-center gap-2 text-muted-foreground">
                <Spinner class="size-4" />
                {{ status.running
                  ? t('admin.canary.running', { mode: modeName(status.running.mode), at: when(status.running.at) })
                  : t('admin.canary.pending', { mode: modeName(status.pending.mode) }) }}
              </div>
              <RunSummary v-if="status.latest" :run="status.latest" :when="when" :mode-name="modeName" />
              <p v-else class="text-muted-foreground">{{ t('admin.canary.never') }}</p>
              <div v-if="status.quick" class="border-t pt-3">
                <div class="mb-1 font-medium">{{ t('admin.canary.quick') }}</div>
                <RunSummary :run="status.quick" :when="when" :mode-name="modeName" />
                <div v-if="system" class="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span v-if="system.disk_used_pct != null" :class="{ 'text-destructive': system.disk_used_pct >= 85 }">
                    {{ t('admin.canary.disk', { pct: system.disk_used_pct }) }}
                  </span>
                  <span>{{ system.backup_last ? t('admin.canary.backup', { at: system.backup_last, mb: Math.round(system.backup_kb / 1024) }) : t('admin.canary.noBackup') }}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{{ t('admin.canary.history') }}</CardTitle>
            </CardHeader>
            <CardContent>
              <p v-if="!status.runs.length" class="text-sm text-muted-foreground">{{ t('admin.canary.never') }}</p>
              <ul class="divide-y text-sm">
                <li v-for="r in status.runs" :key="r.run + r.mode" class="py-2">
                  <button type="button" class="flex w-full items-center gap-3 text-left" @click="toggle(r)">
                    <Badge :variant="r.ok ? 'success' : 'destructive'">{{ r.ok ? t('admin.canary.ok') : t('admin.canary.failedCount', { count: r.failed.length }) }}</Badge>
                    <span class="tabular-nums">{{ when(r.at) }}</span>
                    <span class="text-muted-foreground">{{ modeName(r.mode) }}</span>
                  </button>
                  <div v-if="open[r.run]" class="mt-2 pl-2">
                    <Spinner v-if="open[r.run] === 'loading'" class="size-4" />
                    <ul v-else class="space-y-1 text-xs">
                      <li v-for="(c, i) in open[r.run]" :key="i" class="flex gap-2">
                        <span>{{ c.ok ? '✅' : '❌' }}</span>
                        <span :class="{ 'text-destructive': !c.ok }">{{ c.check }}</span>
                        <span v-if="c.detail" class="text-muted-foreground">{{ c.detail }}</span>
                      </li>
                    </ul>
                  </div>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{{ t('admin.canary.settings') }}</CardTitle>
              <CardDescription>{{ t('admin.canary.settingsHint') }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="grid gap-3 sm:grid-cols-2">
                <label v-for="l in LANES" :key="l.lane" class="flex items-center gap-3 text-sm">
                  <Switch v-model:checked="form.lanes[l.lane]" />
                  {{ t(l.key) }}
                </label>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <AccountSelect v-model="form.fbweb_account" :label="t('admin.canary.fbwebPage')" :options="accountsOf('fb-bridge-web')" />
                <AccountSelect v-model="form.fbweb_customer" :label="t('admin.canary.fbwebCustomer')" :options="accountsOf('facebook')" />
                <AccountSelect v-model="form.fanpage_account" :label="t('admin.canary.fanpagePage')" :options="accountsOf('fbpage')" />
                <AccountSelect v-model="form.fanpage_customer" :label="t('admin.canary.fanpageCustomer')" :options="accountsOf('facebook')" />
              </div>
              <p class="text-xs text-muted-foreground">{{ t('admin.canary.pairsHint') }}</p>
              <Button :disabled="busy" @click="saveSettings">{{ t('globals.messages.save') }}</Button>
            </CardContent>
          </Card>
        </div>
      </LoadingOverlay>
    </template>
    <template #help>
      <p>{{ t('admin.canary.help') }}</p>
    </template>
  </AdminSplitLayout>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AdminSplitLayout from '@/layouts/admin/AdminSplitLayout.vue'
import LoadingOverlay from '@main/components/layout/LoadingOverlay.vue'
import { Button } from '@shared-ui/components/ui/button/index.js'
import { Badge } from '@shared-ui/components/ui/badge/index.js'
import { Switch } from '@shared-ui/components/ui/switch'
import { Spinner } from '@shared-ui/components/ui/spinner/index.js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared-ui/components/ui/card/index.js'
import { useEmitter } from '../../../composables/useEmitter.js'
import { EMITTER_EVENTS } from '../../../constants/emitterEvents.js'
import { canaryChecks, errorMessage } from '../../../features/admin/channel-accounts/channelAccounts.js'
import api from '../../../api/index.js'

const RUN_MODES = [
  { mode: 'full', key: 'admin.canary.runFull' },
  { mode: 'fbweb', key: 'admin.canary.runFbweb' },
  { mode: 'fanpage', key: 'admin.canary.runFanpage' },
  { mode: 'quick', key: 'admin.canary.runQuick' }
]
const LANES = [
  { lane: 'zalo', key: 'admin.canary.laneZalo' },
  { lane: 'facebook', key: 'admin.canary.laneFacebook' },
  { lane: 'fanpage', key: 'admin.canary.laneFanpage' },
  { lane: 'fbweb', key: 'admin.canary.laneFbweb' }
]
const POLL_MS = 10000

const { t, locale } = useI18n()
const emitter = useEmitter()
const loading = ref(false)
const busy = ref(false)
const data = ref(null)
const form = ref({ lanes: {} })
const channels = ref([])
const open = ref({})
let timer = null

const status = computed(() => data.value?.status || { runs: [] })
const system = computed(() => status.value.quick?.report?.system ?? null)

const AccountSelect = defineComponent({
  props: { modelValue: String, label: String, options: Array },
  emits: ['update:modelValue'],
  setup (props, { emit }) {
    return () => h('label', { class: 'space-y-1 text-sm' }, [
      h('span', { class: 'block font-medium' }, props.label),
      h('select', {
        class: 'h-9 w-full rounded-md border bg-background px-2',
        value: props.modelValue || '',
        onChange: (e) => emit('update:modelValue', e.target.value)
      }, [h('option', { value: '' }, t('admin.canary.default')),
        ...(props.options || []).map((o) => h('option', { value: o }, o))])
    ])
  }
})

const RunSummary = defineComponent({
  props: { run: Object, when: Function, modeName: Function },
  setup (props) {
    return () => h('div', { class: 'space-y-1' }, [
      h('div', { class: 'flex items-center gap-2' }, [
        h(Badge, { variant: props.run.ok ? 'success' : 'destructive' },
          () => props.run.ok ? t('admin.canary.ok') : t('admin.canary.failedCount', { count: props.run.failed.length })),
        h('span', { class: 'tabular-nums' }, props.when(props.run.at)),
        h('span', { class: 'text-muted-foreground' }, props.modeName(props.run.mode))
      ]),
      props.run.failed.length
        ? h('ul', { class: 'list-disc pl-5 text-destructive' }, props.run.failed.map((f) => h('li', f)))
        : null
    ])
  }
})

function toast (description, variant) {
  emitter.emit(EMITTER_EVENTS.SHOW_TOAST, variant ? { variant, description } : { description })
}

function when (at) {
  const d = new Date(at)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(locale.value, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function modeName (mode) {
  return t(`admin.canary.mode.${mode}`)
}

function accountsOf (channel) {
  const c = channels.value.find((x) => x.channel === channel)
  return (c?.accounts || []).map((a) => a.name)
}

async function load (withAccounts = false) {
  loading.value = true
  try {
    const [resp, list] = await Promise.all([api.getCanary(), withAccounts ? api.getChannelAccounts() : null])
    data.value = resp.data
    if (withAccounts) {
      channels.value = list.data || []
      const s = resp.data.settings || {}
      form.value = { ...s, lanes: { ...(s.lanes || {}) } }
    }
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  } finally {
    loading.value = false
  }
  clearTimeout(timer)
  if (status.value.pending || status.value.running) timer = setTimeout(() => load(), POLL_MS)
}

async function run (mode) {
  busy.value = true
  try {
    await api.runCanary(mode)
    toast(t('admin.canary.requested'))
    await load()
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  } finally {
    busy.value = false
  }
}

async function toggle (r) {
  if (open.value[r.run]) {
    open.value = { ...open.value, [r.run]: undefined }
    return
  }
  open.value = { ...open.value, [r.run]: 'loading' }
  try {
    const resp = await api.getCanaryRun(r.run)
    open.value = { ...open.value, [r.run]: canaryChecks(resp.data) }
  } catch (error) {
    open.value = { ...open.value, [r.run]: undefined }
    toast(errorMessage(error), 'destructive')
  }
}

async function saveSettings () {
  busy.value = true
  try {
    const resp = await api.saveCanarySettings(form.value)
    form.value = { ...resp.data, lanes: { ...(resp.data.lanes || {}) } }
    toast(t('admin.canary.saved'))
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  } finally {
    busy.value = false
  }
}

onMounted(() => load(true))
onUnmounted(() => clearTimeout(timer))
</script>
