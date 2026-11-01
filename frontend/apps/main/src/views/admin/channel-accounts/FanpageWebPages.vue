<template>
  <!-- omnichannel (D18): Facebook logins on the Fanpage Web agents and their Pages.
       Picking a Page creates its inbox account; the agent starts listening at once. -->
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent class="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ t('admin.channelAccounts.fbweb.pagesTitle') }}</DialogTitle>
        <DialogDescription>{{ t('admin.channelAccounts.fbweb.pagesHint') }}</DialogDescription>
      </DialogHeader>

      <div v-if="loading && !data" class="flex justify-center py-6"><Spinner /></div>
      <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
      <template v-else-if="data">
        <p v-if="!data.logins.length" class="text-sm text-muted-foreground">
          {{ waiting ? t('admin.channelAccounts.fbweb.waitingLogin') : t('admin.channelAccounts.fbweb.noLogins') }}
        </p>

        <section v-for="login in data.logins" :key="`${login.agent}/${login.name}`" class="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
          <div class="flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="font-medium">
                {{ t('admin.channelAccounts.fbweb.login', { name: login.name }) }}
                <span class="text-xs text-muted-foreground">
                  · {{ t('admin.channelAccounts.fbweb.agent', { name: login.agent }) }}
                  <span v-if="!agentOnline(login.agent)" class="text-destructive">({{ t('admin.channelAccounts.fbweb.agentOffline') }})</span>
                </span>
              </div>
              <div v-if="login.error" class="text-xs text-destructive">{{ login.error }}</div>
            </div>
            <Spinner v-if="login.state === 'listing'" class="size-4" />
            <Button size="sm" variant="outline" :disabled="login.state === 'listing'" @click="refresh(login.name)">
              {{ t('admin.channelAccounts.fbweb.refresh') }}
            </Button>
            <Button size="sm" :variant="login.state === 'logged_out' ? 'default' : 'outline'" @click="emit('relogin', login.name)">
              {{ t('admin.channelAccounts.relogin') }}
            </Button>
          </div>

          <p v-if="!login.pages.length && login.state !== 'listing'" class="text-sm text-muted-foreground">
            {{ t('admin.channelAccounts.fbweb.noPages') }}
          </p>
          <ul class="divide-y">
            <li v-for="page in login.pages" :key="page.id" class="flex flex-wrap items-center gap-3 py-2">
              <Avatar class="size-8">
                <AvatarImage v-if="page.picture" :src="page.picture" referrerpolicy="no-referrer" />
                <AvatarFallback>{{ page.name.slice(0, 2).toUpperCase() }}</AvatarFallback>
              </Avatar>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ page.name }}</div>
                <div class="truncate text-xs text-muted-foreground">
                  {{ page.id }}
                  <span v-if="page.account"> · {{ t('admin.channelAccounts.fbweb.account', { name: page.account }) }}</span>
                  <span v-if="page.account && !onThisLogin(page, login)" class="text-amber-600 dark:text-amber-400">
                    · {{ t('admin.channelAccounts.fbweb.otherSource') }}
                  </span>
                </div>
              </div>

              <!-- Already picked on this login: toggle sending, or remove -->
              <template v-if="page.account && onThisLogin(page, login)">
                <label class="flex items-center gap-2 text-sm">
                  <Switch :checked="page.send" :disabled="saving === page.id" @update:checked="(on) => save(login, page, page.account, on)" />
                  {{ t('admin.channelAccounts.fbweb.send') }}
                </label>
                <Button size="sm" variant="ghost" class="text-destructive" @click="emit('remove', page.account)">
                  {{ t('admin.channelAccounts.remove') }}
                </Button>
              </template>
              <!-- Picked elsewhere (env, Mac): move it onto this login, same account -->
              <Button
                v-else-if="page.account"
                size="sm"
                variant="outline"
                :disabled="saving === page.id"
                @click="save(login, page, page.account, page.send)"
              >
                {{ t('admin.channelAccounts.fbweb.move') }}
              </Button>
              <template v-else>
                <Input v-model="draft(page).name" class="h-8 w-44" :placeholder="t('admin.channelAccounts.accountName')" />
                <label class="flex items-center gap-2 text-sm">
                  <Switch v-model:checked="draft(page).send" />
                  {{ t('admin.channelAccounts.fbweb.send') }}
                </label>
                <Button size="sm" :disabled="saving === page.id" @click="add(login, page)">
                  {{ t('admin.channelAccounts.fbweb.add') }}
                </Button>
              </template>
            </li>
          </ul>
        </section>
      </template>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shared-ui/components/ui/button/index.js'
import { Input } from '@shared-ui/components/ui/input/index.js'
import { Switch } from '@shared-ui/components/ui/switch'
import { Spinner } from '@shared-ui/components/ui/spinner/index.js'
import { Avatar, AvatarFallback, AvatarImage } from '@shared-ui/components/ui/avatar/index.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shared-ui/components/ui/dialog/index.js'
import { errorMessage, isValidAccountName, loginPending, pageSlug } from '../../../features/admin/channel-accounts/channelAccounts.js'
import api from '../../../api/index.js'

const POLL_MS = 2000
const WAIT_LOGIN_MS = 2 * 60 * 1000

// waitFor: login name just signed in; keep polling until an agent lists its Pages.
const props = defineProps({ open: Boolean, waitFor: { type: String, default: '' }, reload: { type: Number, default: 0 } })
const emit = defineEmits(['close', 'relogin', 'remove', 'changed', 'toast'])
const { t } = useI18n()

const data = ref(null)
const loading = ref(false)
const error = ref('')
const saving = ref('')
const waiting = ref(false)
const drafts = ref({})
let timer = null
let deadline = 0

function draft (page) {
  if (!drafts.value[page.id]) drafts.value[page.id] = { name: pageSlug(page.name), send: false }
  return drafts.value[page.id]
}

function agentOnline (name) {
  return (data.value?.agents || []).some((a) => a.name === name && a.online)
}

// The Page's account runs on this login (not on another agent, login or the Mac).
function onThisLogin (page, login) {
  const cfg = (data.value?.pages || []).find((p) => p.account === page.account)
  return cfg && cfg.agent === login.agent && cfg.login === login.name
}

async function load () {
  loading.value = true
  try {
    const resp = await api.getFanpageWebLogins()
    data.value = { agents: [], logins: [], pages: [], ...resp.data }
    error.value = ''
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
  schedule()
}

function schedule () {
  clearTimeout(timer)
  if (!props.open) return
  const listing = (data.value?.logins || []).some((l) => l.state === 'listing')
  waiting.value = !!props.waitFor && loginPending(data.value?.logins, props.waitFor) && Date.now() < deadline
  if (listing || waiting.value) timer = setTimeout(load, POLL_MS)
}

async function refresh (name) {
  try {
    await api.refreshFanpageWebLogin(name)
    const login = data.value.logins.find((l) => l.name === name)
    if (login) login.state = 'listing'
    schedule()
  } catch (e) {
    emit('toast', errorMessage(e), 'destructive')
  }
}

async function save (login, page, name, send) {
  saving.value = page.id
  try {
    await api.setFanpageWebPage(name, { page_id: page.id, agent: login.agent, login: login.name, send })
    emit('changed')
    await load()
  } catch (e) {
    emit('toast', errorMessage(e), 'destructive')
  } finally {
    saving.value = ''
  }
}

function add (login, page) {
  const d = draft(page)
  if (!isValidAccountName(d.name)) {
    emit('toast', t('admin.channelAccounts.invalidName'), 'destructive')
    return
  }
  save(login, page, d.name, d.send)
}

watch(
  () => [props.open, props.waitFor, props.reload],
  ([open]) => {
    clearTimeout(timer)
    if (!open) return
    deadline = Date.now() + WAIT_LOGIN_MS
    drafts.value = {}
    load()
  },
  { immediate: true }
)

onUnmounted(() => clearTimeout(timer))
</script>
