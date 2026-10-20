// Shared count of channel accounts that need an admin (signed out / dropped),
// shown as a red dot on the Admin rail icon and the "Channel accounts" menu.
// One poller for the whole app, only for users who can manage inboxes.
import { ref } from 'vue'
import api from '@main/api'
import { countAccountAlerts } from './channelAccounts.js'

const POLL_MS = 60000
export const channelAlertCount = ref(0)
let timer = null

export function setChannelAlerts (channels) {
  channelAlertCount.value = countAccountAlerts(channels)
}

async function poll () {
  try {
    const resp = await api.getChannelAccounts()
    setChannelAlerts(resp.data || [])
  } catch {
    // Gateway không trả lời: giữ số cũ; trang Channel accounts sẽ báo lỗi.
  }
}

export function useChannelAlerts (canManage) {
  if (canManage && !timer) {
    poll()
    timer = setInterval(poll, POLL_MS)
  }
  return channelAlertCount
}
