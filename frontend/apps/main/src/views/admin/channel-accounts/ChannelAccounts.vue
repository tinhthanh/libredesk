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
                    </div>
                    <Badge :variant="stateInfo(account.state).variant">
                      {{ t(stateInfo(account.state).key) }}
                    </Badge>
                    <div class="flex gap-2">
                      <Button size="sm" variant="outline" @click="openLogin(channel, account.name)">
                        {{ t('admin.channelAccounts.relogin') }}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        :disabled="busy === key(channel, account.name)"
                        @click="reconnect(channel, account.name)"
                      >
                        {{ t('admin.channelAccounts.reconnect') }}
                      </Button>
                      <Button size="sm" variant="ghost" class="text-destructive" @click="askRemove(channel, account.name)">
                        {{ t('admin.channelAccounts.remove') }}
                      </Button>
                    </div>
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
              <DialogDescription>{{ t('admin.channelAccounts.help') }}</DialogDescription>
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

              <!-- Facebook: embedded browser or cookie -->
              <Tabs v-else v-model="login.tab" class="w-full">
                <TabsList>
                  <TabsTrigger v-if="login.channel.browser_login" value="browser">
                    {{ t('admin.channelAccounts.browser') }}
                  </TabsTrigger>
                  <TabsTrigger value="cookie">{{ t('admin.channelAccounts.cookie') }}</TabsTrigger>
                </TabsList>
                <TabsContent v-if="login.channel.browser_login" value="browser" class="space-y-2">
                  <div v-if="!login.started" class="flex items-center gap-3">
                    <Button @click="startLogin">{{ t('admin.channelAccounts.start') }}</Button>
                  </div>
                  <p v-if="login.status?.message" class="text-sm">{{ login.status.message }}</p>
                  <iframe
                    v-if="login.status?.vnc && !finished"
                    :src="login.status.vnc"
                    class="w-full aspect-[16/10] rounded-md border bg-black"
                    referrerpolicy="no-referrer"
                  />
                  <Button v-if="login.started && !finished" variant="outline" size="sm" @click="cancelLogin">
                    {{ t('admin.channelAccounts.cancelLogin') }}
                  </Button>
                </TabsContent>
                <TabsContent value="cookie" class="space-y-2">
                  <Textarea v-model="login.cookie" rows="4" placeholder="c_user=...; xs=...; datr=...; fr=...;" />
                  <p class="text-xs text-muted-foreground">{{ t('admin.channelAccounts.cookieHint') }}</p>
                  <Button :disabled="login.saving || !login.cookie.trim()" @click="saveCookie">
                    {{ t('admin.channelAccounts.saveCookie') }}
                  </Button>
                  <p v-if="login.cookieMessage" class="text-sm">{{ login.cookieMessage }}</p>
                </TabsContent>
              </Tabs>
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared-ui/components/ui/tabs/index.js'
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
  displayName,
  errorMessage,
  isLoginFinished,
  isValidAccountName,
  stateInfo
} from '../../../features/admin/channel-accounts/channelAccounts.js'
import api from '../../../api/index.js'

const LIST_REFRESH_MS = 10000
const LOGIN_POLL_MS = 2000

const { t } = useI18n()
const emitter = useEmitter()
const isLoading = ref(false)
const channels = ref([])
const busy = ref('')
const login = ref(null) // {channel, name, locked, tab, started, status, cookie, saving, cookieMessage}
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
    tab: channel.browser_login ? 'browser' : 'cookie',
    started: false,
    status: null,
    cookie: '',
    saving: false,
    cookieMessage: ''
  }
  // Zalo bắt đầu tạo QR ngay khi biết tên tài khoản.
  if (name && channel.qr_login) startLogin()
}

function lockName () {
  if (!isValidAccountName(login.value.name)) {
    toast(t('admin.channelAccounts.invalidName'), 'destructive')
    return
  }
  login.value.locked = true
  if (login.value.channel.qr_login) startLogin()
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

async function saveCookie () {
  const current = login.value
  current.saving = true
  current.cookieMessage = ''
  try {
    await api.setChannelCookie(current.channel.channel, current.name, current.cookie.trim())
    toast(t('admin.channelAccounts.loginDone'))
    current.cookie = ''
    closeLogin()
    loadAccounts()
  } catch (error) {
    current.cookieMessage = errorMessage(error)
  } finally {
    current.saving = false
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
