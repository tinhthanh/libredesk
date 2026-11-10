// Gọi khách Zalo từ Libredesk (omnichannel docs/plan-zalo-call.md).
// Trình duyệt nói WebRTC với zalo-call qua TURN; gateway chỉ chuyển offer/answer và trạng thái.
// Trạng thái là singleton ở cấp module: chuyển sang hội thoại khác thì cuộc gọi vẫn tiếp tục
// và thanh cuộc gọi hiện lại khi mở lại hội thoại đó.
import { reactive } from 'vue'
import api from '@main/api'

export const call = reactive({
  id: '',
  conversationUUID: '',
  contactName: '',
  // idle | starting | dialing | ringing | in_call | ended
  state: 'idle',
  reason: '',
  error: '',
  muted: false,
  startedAt: 0,
  answeredAt: 0,
  durationSecs: 0
})

// Tài khoản Zalo được gọi điện (admin bật trên trang Tài khoản kênh). Gateway trả 404 khi chưa
// có zalo-call. Hỏi lại sau mỗi phút để bật/tắt có tác dụng mà không cần tải lại trang.
export const callFeature = reactive({ checked: false, accounts: [] })
const FEATURE_TTL_MS = 60 * 1000
let featureProbe = null
let featureAt = 0

export function ensureCallFeature() {
  if (!featureProbe || Date.now() - featureAt > FEATURE_TTL_MS) {
    featureAt = Date.now()
    featureProbe = api
      .getChannelCallAccounts()
      .then(({ data }) => {
        callFeature.accounts = Array.isArray(data?.zalo_accounts) ? data.zalo_accounts : []
      })
      .catch(() => {
        callFeature.accounts = []
      })
      .finally(() => {
        callFeature.checked = true
      })
  }
  return featureProbe
}

// Tên tài khoản Zalo của hội thoại: inbox gateway đặt tên "Zalo - <tài khoản>".
export function zaloAccountOf(conversation) {
  const name = conversation?.inbox_name || ''
  return name.startsWith('Zalo - ') ? name.slice('Zalo - '.length) : ''
}

let pc = null
let mic = null
let audio = null
let poll = null
let tick = null

// Thời lượng "m:ss".
export function formatCallDuration(secs) {
  const s = Math.max(0, Math.floor(secs || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Khoá i18n cho trạng thái hoặc lý do kết thúc (gateway/zalo-call `reason`).
export function callStatusKey(state, reason) {
  if (state === 'ended') {
    const known = ['customer_hangup', 'agent_hangup', 'no_answer', 'rejected', 'busy', 'cancelled', 'browser_gone', 'max_duration', 'ended_before_answer']
    return `conversation.call.end.${known.includes(reason) ? reason : 'error'}`
  }
  return `conversation.call.state.${state || 'idle'}`
}

export const callActive = () => !['idle', 'ended'].includes(call.state)

// Đợi ICE gom xong (offer không trickle), tối đa `ms`.
export function waitIceGathering(peer, ms = 5000) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      peer.removeEventListener('icegatheringstatechange', check)
      clearTimeout(timer)
      resolve()
    }
    const check = () => peer.iceGatheringState === 'complete' && done()
    const timer = setTimeout(done, ms)
    peer.addEventListener('icegatheringstatechange', check)
  })
}

function cleanup() {
  clearInterval(poll)
  clearInterval(tick)
  poll = tick = null
  mic?.getTracks().forEach((t) => t.stop())
  mic = null
  try {
    pc?.close()
  } catch {
    // đã đóng
  }
  pc = null
  if (audio) {
    audio.srcObject = null
    audio = null
  }
}

function finish(reason, error = '') {
  cleanup()
  call.state = 'ended'
  call.reason = reason
  call.error = error
}

async function refresh() {
  if (!call.id) return
  try {
    const { data } = await api.getChannelCall(call.id)
    if (data.state === 'in_call' && !call.answeredAt) call.answeredAt = Date.now()
    if (data.state === 'ended') {
      call.durationSecs = data.duration_secs || call.durationSecs
      finish(data.reason || 'error')
      return
    }
    if (['dialing', 'ringing', 'in_call'].includes(data.state)) call.state = data.state
  } catch (e) {
    if (e?.response?.status === 404) finish('error')
  }
}

// Bắt đầu gọi khách của hội thoại. Trả lỗi (chuỗi) để hiện toast, hoặc ''.
export async function startCall(conversationUUID, contactName) {
  if (callActive()) return 'busy_local'
  Object.assign(call, {
    id: '', conversationUUID, contactName, state: 'starting', reason: '', error: '',
    muted: false, startedAt: Date.now(), answeredAt: 0, durationSecs: 0
  })
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch {
    finish('error', 'mic')
    return 'mic'
  }
  try {
    const { data: ice } = await api.getChannelCallIce()
    pc = new RTCPeerConnection({ iceServers: ice.ice_servers || [], iceTransportPolicy: 'relay' })
    mic.getTracks().forEach((t) => pc.addTrack(t, mic))
    audio = new Audio()
    audio.autoplay = true
    pc.ontrack = (ev) => {
      audio.srcObject = ev.streams[0] || new MediaStream([ev.track])
      audio.play().catch(() => {})
    }
    pc.onconnectionstatechange = () => {
      if (pc && pc.connectionState === 'failed' && callActive()) hangupCall()
    }
    await pc.setLocalDescription(await pc.createOffer())
    await waitIceGathering(pc)
    const { data } = await api.startChannelCall(conversationUUID, pc.localDescription.sdp)
    call.id = data.id
    await pc.setRemoteDescription({ type: 'answer', sdp: data.answer_sdp })
    call.state = 'dialing'
    poll = setInterval(refresh, 1000)
    tick = setInterval(() => {
      if (call.answeredAt) call.durationSecs = Math.floor((Date.now() - call.answeredAt) / 1000)
    }, 1000)
    return ''
  } catch (e) {
    const msg = e?.response?.data?.error || e?.message || ''
    finish('error', msg)
    return msg || 'error'
  }
}

export async function hangupCall() {
  if (!call.id) {
    finish('cancelled')
    return
  }
  try {
    await api.hangupChannelCall(call.id)
  } catch {
    // zalo-call đã kết thúc cuộc gọi
  }
  await refresh()
  if (callActive()) setTimeout(refresh, 1500)
}

export function toggleMute() {
  call.muted = !call.muted
  mic?.getAudioTracks().forEach((t) => {
    t.enabled = !call.muted
  })
}

export function dismissCall() {
  if (callActive()) return
  Object.assign(call, { id: '', conversationUUID: '', state: 'idle', reason: '', error: '' })
}
