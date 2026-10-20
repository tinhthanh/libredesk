<template>
  <div>
    <AdminSplitLayout>
      <template #content>
        <LoadingOverlay :loading="isLoading && !channels.length" reserve-height>
          <div class="space-y-6">
            <Card v-for="channel in channels" :key="channel.channel">
              <CardHeader class="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>{{ channel.label }}</CardTitle>
                  <CardDescription v-if="channel.error" class="text-destructive">
                    {{ t('admin.channelAccounts.unavailable') }}: {{ channel.error }}
                  </CardDescription>
                </div>
                <Button size="sm" :disabled="!!channel.error" @click="openLogin(channel, null)">
                  {{ t('admin.channelAccounts.add') }}
                </Button>
              </CardHeader>
              <CardContent>
                <p v-if="!channel.accounts.length" class="text-sm text-muted-foreground">
                  {{ t('admin.channelAccounts.empty') }}
                </p>
                <ul class="divide-y">
                  <li
                    v-for="account in channel.accounts"
                    :key="account.name"
                    class="flex flex-wrap items-center gap-3 py-3"
                  >
                    <Avatar class="size-9">
                      <AvatarImage
                        v-if="account.profile?.avatar"
                        :src="account.profile.avatar"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback>{{ displayName(account).slice(0, 2).toUpperCase() }}</AvatarFallback>
                    </Avatar>
                    <div class="min-w-0 flex-1">
                      <div class="font-medium truncate">{{ displayName(account) }}</div>
                      <div class="text-xs text-muted-foreground truncate">
                        {{ channel.label }} - {{ account.name }}
                        <span v-if="account.profile?.uid"> · {{ account.profile.uid }}</span>
                      </div>
                      <div
                        v-if="accountReason(account)"
                        class="text-xs mt-0.5"
                        :class="needsSignIn(account) ? 'text-destructive' : 'text-muted-foreground'"
                      >
                        {{ accountReason(account) }}
                      </div>
                    </div>
                    <Badge :variant="accountStatus(account).variant">
                      {{ t(accountStatus(account).key) }}
                    </Badge>
                    <div class="flex gap-2">
                      <Button
                        size="sm"
                        :variant="needsSignIn(account) ? 'default' : 'outline'"
                        @click="openLogin(channel, account.name)"
                      >
                        {{ t('admin.channelAccounts.relogin') }}
                      </Button>
                      <Button
                        v-if="!needsSignIn(account)"
                        size="sm"
                        variant="outline"
                        :disabled="busy === key(channel, account.name)"
                        @click="reconnect(channel, account.name)"
                      >
                        {{ t('admin.channelAccounts.reconnect') }}
                      </Button>
                      <Button
                        v-if="account.state === 'running'"
                        size="sm"
                        variant="outline"
                        @click="openCompose(channel, account)"
                      >
                        {{ t('admin.channelAccounts.newMessage') }}
                      </Button>
                      <Button size="sm" variant="ghost" class="text-destructive" @click="askRemove(channel, account.name)">
                        {{ t('admin.channelAccounts.remove') }}
                      </Button>
                    </div>
                    <!-- omnichannel: why and when the account dropped, as reported by the bot -->
                    <details v-if="account.history?.length" class="basis-full pl-12 text-xs">
                      <summary class="cursor-pointer text-muted-foreground select-none">
                        {{ t('admin.channelAccounts.history', { count: account.history.length }) }}
                      </summary>
                      <ul class="mt-2 space-y-1">
                        <li v-for="(entry, i) in historyEntries(account, locale)" :key="i" class="flex gap-2">
                          <span class="w-24 shrink-0 tabular-nums text-muted-foreground">{{ entry.at }}</span>
                          <span>{{ entry.icon }}</span>
                          <span :class="entry.tone">
                            {{ entry.message }}
                            <span v-if="entry.count" class="text-muted-foreground">
                              ({{ t('admin.channelAccounts.historyRepeat', { count: entry.count, at: entry.lastAt }) }})
                            </span>
                          </span>
                        </li>
                      </ul>
                    </details>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </LoadingOverlay>

        <Dialog :open="!!login" @update:open="(open) => !open && closeLogin()">
          <DialogContent :class="login?.channel.browser_login ? 'sm:max-w-[960px]' : 'sm:max-w-[440px]'">
            <DialogHeader>
              <DialogTitle>
                {{ login?.channel.label }}
                <span v-if="login?.locked">- {{ login?.name }}</span>
              </DialogTitle>
              <DialogDescription>
                {{ t(login?.channel.qr_login ? 'admin.channelAccounts.scanQr' : 'admin.channelAccounts.facebookHint') }}
              </DialogDescription>
            </DialogHeader>

            <div v-if="login && !login.locked" class="space-y-2">
              <label class="text-sm font-medium">{{ t('admin.channelAccounts.accountName') }}</label>
              <div class="flex gap-2">
                <Input v-model="login.name" placeholder="shop1" @keydown.enter="lockName" />
                <Button @click="lockName">{{ t('admin.channelAccounts.start') }}</Button>
              </div>
              <p class="text-xs text-muted-foreground">{{ t('admin.channelAccounts.accountNameHint') }}</p>
            </div>

            <template v-else-if="login">
              <!-- Zalo: QR -->
              <div v-if="login.channel.qr_login" class="flex flex-col items-center gap-3">
                <img
                  v-if="login.status?.qr"
                  :src="login.status.qr"
                  alt="QR"
                  class="size-64 rounded-md border bg-white p-2 [image-rendering:pixelated]"
                />
                <Spinner v-else-if="!finished" />
                <p class="text-sm text-center">{{ login.status?.message || t('admin.channelAccounts.scanQr') }}</p>
              </div>

              <!-- Facebook: embedded browser (noVNC) -->
              <div v-else class="space-y-2">
                <div class="flex items-center gap-2 text-sm">
                  <Spinner v-if="login.started && !finished && !login.status?.vnc" class="size-4" />
                  <span>{{ login.status?.message }}</span>
                </div>
                <iframe
                  v-if="login.status?.vnc && !finished"
                  :src="login.status.vnc"
                  class="w-full aspect-[16/10] rounded-md border bg-black"
                  referrerpolicy="no-referrer"
                />
                <div class="flex gap-2">
                  <Button v-if="!login.started || (finished && login.status?.status !== 'success')" @click="startLogin">
                    {{ t('admin.channelAccounts.start') }}
                  </Button>
                  <Button v-if="login.started && !finished" variant="outline" size="sm" @click="cancelLogin">
                    {{ t('admin.channelAccounts.cancelLogin') }}
                  </Button>
                </div>
              </div>
            </template>
          </DialogContent>
        </Dialog>

        <Dialog :open="!!compose" @update:open="(open) => !open && (compose = null)">
          <DialogContent class="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>
                {{ t('admin.channelAccounts.newMessage') }} - {{ compose?.channel.label }} {{ compose?.account }}
              </DialogTitle>
              <DialogDescription>{{ t('admin.channelAccounts.newMessageHint') }}</DialogDescription>
            </DialogHeader>
            <template v-if="compose">
              <Input
                v-model="compose.to"
                :placeholder="
                  compose.channel.channel === 'zalo'
                    ? t('admin.channelAccounts.recipientZalo')
                    : t('admin.channelAccounts.recipientFacebook')
                "
              />
              <Textarea v-model="compose.text" rows="4" :placeholder="t('admin.channelAccounts.firstMessage')" />
              <p v-if="compose.error" class="text-sm text-destructive">{{ compose.error }}</p>
              <div class="flex justify-end">
                <Button :disabled="compose.sending || !compose.to.trim() || !compose.text.trim()" @click="sendFirstMessage">
                  {{ t('admin.channelAccounts.sendFirst') }}
                </Button>
              </div>
            </template>
          </DialogContent>
        </Dialog>

        <AlertDialog :open="!!removing" @update:open="(open) => !open && (removing = null)">
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{{ t('admin.channelAccounts.remove') }}</AlertDialogTitle>
              <AlertDialogDescription>
                {{ t('admin.channelAccounts.removeConfirm', { name: removing ? `${removing.channel.label} - ${removing.name}` : '' }) }}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{{ t('globals.messages.cancel') }}</AlertDialogCancel>
              <AlertDialogAction @click="confirmRemove">{{ t('admin.channelAccounts.remove') }}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </template>

      <template #help>
        <p>{{ t('admin.channelAccounts.help') }}</p>
      </template>
    </AdminSplitLayout>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AdminSplitLayout from '@/layouts/admin/AdminSplitLayout.vue'
import LoadingOverlay from '@main/components/layout/LoadingOverlay.vue'
import { Button } from '@shared-ui/components/ui/button/index.js'
import { Badge } from '@shared-ui/components/ui/badge/index.js'
import { Input } from '@shared-ui/components/ui/input/index.js'
import { Textarea } from '@shared-ui/components/ui/textarea/index.js'
import { Spinner } from '@shared-ui/components/ui/spinner/index.js'
import { Avatar, AvatarFallback, AvatarImage } from '@shared-ui/components/ui/avatar/index.js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared-ui/components/ui/card/index.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shared-ui/components/ui/dialog/index.js'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shared-ui/components/ui/alert-dialog/index.js'
import { useEmitter } from '../../../composables/useEmitter.js'
import { EMITTER_EVENTS } from '../../../constants/emitterEvents.js'
import {
  accountReason,
  accountStatus,
  displayName,
  errorMessage,
  historyEntries,
  isLoginFinished,
  isValidAccountName,
  needsSignIn
} from '../../../features/admin/channel-accounts/channelAccounts.js'
import api from '../../../api/index.js'
import { setChannelAlerts } from '../../../features/admin/channel-accounts/useChannelAlerts.js'

const LIST_REFRESH_MS = 10000
const LOGIN_POLL_MS = 2000
const CLOSE_AFTER_SUCCESS_MS = 1500

const { t, locale } = useI18n()
const router = useRouter()
const emitter = useEmitter()
const isLoading = ref(false)
const channels = ref([])
const busy = ref('')
const login = ref(null) // {channel, name, locked, started, status}
const removing = ref(null)
let listTimer = null
let pollTimer = null

const finished = computed(() => isLoginFinished(login.value?.status?.status))
const key = (channel, name) => `${channel.channel}/${name}`

function toast (description, variant) {
  emitter.emit(EMITTER_EVENTS.SHOW_TOAST, variant ? { variant, description } : { description })
}

async function loadAccounts () {
  isLoading.value = true
  try {
    const resp = await api.getChannelAccounts()
    channels.value = (resp.data || []).map((c) => ({ ...c, accounts: c.accounts || [] }))
    setChannelAlerts(channels.value)
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  } finally {
    isLoading.value = false
  }
}

function openLogin (channel, name) {
  login.value = {
    channel,
    name: name || '',
    locked: !!name,
    started: false,
    status: null
  }
  // Biết tên tài khoản là bắt đầu luôn: Zalo tạo QR, Facebook mở trình duyệt.
  if (name) startLogin()
}

function lockName () {
  if (!isValidAccountName(login.value.name)) {
    toast(t('admin.channelAccounts.invalidName'), 'destructive')
    return
  }
  login.value.locked = true
  startLogin()
}

async function startLogin () {
  const { channel, name } = login.value
  login.value.started = true
  try {
    const resp = await api.startChannelLogin(channel.channel, name)
    if (login.value) login.value.status = resp.data
    schedulePoll()
  } catch (error) {
    if (login.value) login.value.status = { status: 'error', message: errorMessage(error) }
  }
}

function schedulePoll () {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(pollLogin, LOGIN_POLL_MS)
}

async function pollLogin () {
  const current = login.value
  if (!current || !current.started) return
  try {
    const resp = await api.getChannelLogin(current.channel.channel, current.name)
    if (login.value !== current) return
    current.status = resp.data
  } catch (error) {
    if (login.value !== current) return
    current.status = { status: 'error', message: errorMessage(error) }
  }
  if (current.status?.status === 'success') {
    toast(t('admin.channelAccounts.loginDone'))
    loadAccounts()
    setTimeout(() => login.value === current && closeLogin(), CLOSE_AFTER_SUCCESS_MS)
    return
  }
  if (!isLoginFinished(current.status?.status)) schedulePoll()
}

async function cancelLogin () {
  const { channel, name } = login.value
  clearTimeout(pollTimer)
  try {
    const resp = await api.cancelChannelLogin(channel.channel, name)
    if (login.value) login.value.status = { ...resp.data, status: 'cancelled' }
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  }
}

function closeLogin () {
  const current = login.value
  clearTimeout(pollTimer)
  login.value = null
  // Đóng hộp thoại khi trình duyệt Facebook còn mở: dừng phiên để giải phóng RAM.
  if (current?.started && current.channel.browser_login && !isLoginFinished(current.status?.status)) {
    api.cancelChannelLogin(current.channel.channel, current.name).catch(() => {})
  }
}

// Message a customer first: the gateway finds the recipient and returns the
// contact identity it uses; the conversation is created as the current agent.
const compose = ref(null) // { channel, account, to, text, sending, error }

function openCompose (channel, account) {
  compose.value = { channel, account: account.name, to: '', text: '', sending: false, error: '' }
}

function escapeHTML (s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

async function sendFirstMessage () {
  const c = compose.value
  c.sending = true
  c.error = ''
  try {
    const { data: who } = await api.resolveChannelRecipient(c.channel.channel, c.account, c.to.trim())
    const html = c.text.trim().split('\n').map((line) => `<p>${escapeHTML(line)}</p>`).join('')
    let uuid = who.conversation_uuid
    if (uuid) {
      await api.sendMessage(uuid, { message: html, private: false, sender_type: 'agent', attachments: [], mentions: [] })
    } else {
      const resp = await api.createConversation({
        inbox_id: who.inbox_id,
        contact_email: who.contact_email,
        first_name: who.first_name,
        last_name: who.last_name,
        external_user_id: who.external_user_id,
        reuse_contact: true,
        initiator: 'agent',
        subject: who.first_name,
        content: html
      })
      uuid = resp.data.data.uuid
    }
    compose.value = null
    router.push({ name: 'inbox-conversation', params: { type: 'all', uuid } })
  } catch (error) {
    if (compose.value) compose.value.error = errorMessage(error)
  } finally {
    if (compose.value) compose.value.sending = false
  }
}

async function reconnect (channel, name) {
  busy.value = key(channel, name)
  try {
    await api.restartChannelAccount(channel.channel, name)
    await loadAccounts()
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  } finally {
    busy.value = ''
  }
}

function askRemove (channel, name) {
  removing.value = { channel, name }
}

async function confirmRemove () {
  const { channel, name } = removing.value
  removing.value = null
  try {
    await api.removeChannelAccount(channel.channel, name)
    await loadAccounts()
  } catch (error) {
    toast(errorMessage(error), 'destructive')
  }
}

onMounted(() => {
  loadAccounts()
  listTimer = setInterval(loadAccounts, LIST_REFRESH_MS)
})

onUnmounted(() => {
  clearInterval(listTimer)
  closeLogin()
})
</script>
