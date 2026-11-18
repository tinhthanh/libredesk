// Nghe máy cuộc gọi Fanpage Web trong Libredesk (omnichannel docs/plan-fbweb-call.md, P3).
// Khách gọi Trang qua Messenger; trình duyệt nói WebRTC thẳng với máy chủ media của Meta (ice-lite,
// STUN của Meta, không TURN). Gateway chỉ chuyển SDP: /gw/fbweb-calls/{account}/{room}/{action}.
// Cùng cách cửa sổ cuộc gọi của Business Suite (fbweb-ls/calltest.html, thử thật 18/11/2026):
//   audio gửi và nhận, video chỉ nhận (camera của khách), một data channel; server trả SDP answer rồi
//   SDP offer mới thêm luồng của khách, trình duyệt áp cả hai (answer của offer này không gửi đi),
//   sau đó gateway báo nhận luồng (subscribe).
// Trạng thái là singleton ở cấp module: đổi hội thoại thì cuộc gọi vẫn tiếp tục.
import { reactive, shallowRef } from 'vue'
import api from '@main/api'

export const FBWEB_CHANNEL = 'fb-bridge-web'

export const fbwebCall = reactive({
  key: '', // `${account}:${call_id}` như danh sách cuộc gọi của gateway
  account: '',
  callId: '',
  conversationUUID: '',
  // idle | answering | in_call
  state: 'idle',
  muted: false,
  // Camera của khách đang bật (track video nhận được có hình).
  remoteVideo: false,
  answeredAt: 0
})

export const fbwebVideo = { remote: shallowRef(null) }

const STUN = [{ urls: 'stun:stun.fbsbx.com:3478' }]
// Tham số Opus như Business Suite gửi (offer 18/11/2026).
const OPUS_FMTP = 'minptime=10;useinbandfec=0;stereo=0;usedtx=1;maxaveragebitrate=20000;maxplaybackrate=16000'

let pc = null
let mic = null
let audio = null
let seq = 0

export const fbwebKey = (c) => `${c.account}:${c.call_id}`

export function isFbwebCall (c) {
  return c?.channel === FBWEB_CHANNEL
}

// Tên Trang của hội thoại Fanpage Web: inbox gateway đặt tên "Fanpage Web - <tài khoản>".
export function fbwebAccountOf (conversation) {
  const name = conversation?.inbox_name || ''
  return name.startsWith('Fanpage Web - ') ? name.slice('Fanpage Web - '.length) : ''
}

export function fbwebSupported () {
  return typeof window !== 'undefined' && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia
}

function munge (sdp) {
  return sdp.replace(/a=fmtp:111 [^\r\n]*/, 'a=fmtp:111 ' + OPUS_FMTP)
}

function cleanup () {
  if (pc) {
    pc.ontrack = null
    pc.onconnectionstatechange = null
    try { pc.close() } catch { /* đã đóng */ }
  }
  if (mic) mic.getTracks().forEach((t) => t.stop())
  if (audio) {
    audio.srcObject = null
    audio.remove()
  }
  pc = null
  mic = null
  audio = null
  fbwebVideo.remote.value = null
  Object.assign(fbwebCall, { key: '', account: '', callId: '', conversationUUID: '', state: 'idle', muted: false, remoteVideo: false, answeredAt: 0 })
}

// Lỗi của gateway là tiếng Việt cho nhân viên; '' -> câu chung của nơi gọi.
const errorOf = (error) => error?.response?.data?.error || ''

// answerFbwebCall nghe máy cuộc gọi c (một mục của GET /gw/calls/ringing).
// Trả { ok, error, reason }: reason 'mic' (không có micro), 'insecure' (trang không phải https/localhost), 'busy'.
export async function answerFbwebCall (c) {
  if (fbwebCall.state !== 'idle') return { ok: false, reason: 'busy', error: '' }
  if (!window.isSecureContext) return { ok: false, reason: 'insecure', error: '' }
  const my = ++seq
  Object.assign(fbwebCall, {
    key: fbwebKey(c), account: c.account, callId: c.call_id, conversationUUID: c.conversation_uuid || '', state: 'answering'
  })
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    if (my === seq) cleanup()
    return { ok: false, reason: 'mic', error: '' }
  }
  try {
    pc = new RTCPeerConnection({ bundlePolicy: 'max-compat', iceServers: STUN })
    pc.addTrack(mic.getAudioTracks()[0], mic)
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.createDataChannel('fb')
    pc.ontrack = (e) => {
      if (e.track.kind === 'audio') {
        if (!audio) {
          audio = document.createElement('audio')
          audio.autoplay = true
          audio.style.display = 'none'
          document.body.appendChild(audio)
        }
        audio.srcObject = e.streams[0] || new MediaStream([e.track])
      } else if (e.track.kind === 'video' && e.transceiver?.mid === '3') {
        // mid 3: camera của khách (SDP offer mới của server). Có hình khi khách bật camera.
        fbwebVideo.remote.value = new MediaStream([e.track])
        e.track.onunmute = () => { fbwebCall.remoteVideo = true }
        e.track.onmute = () => { fbwebCall.remoteVideo = false }
      }
    }
    pc.onconnectionstatechange = () => {
      if (pc && pc.connectionState === 'failed') hangupFbwebCall()
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription({ type: 'offer', sdp: munge(offer.sdp) })
    const { data } = await api.fbwebCallAction(c.account, c.call_id, 'answer', { offer: pc.localDescription.sdp })
    if (my !== seq || !pc) return { ok: false, reason: '', error: '' }
    await pc.setRemoteDescription({ type: 'answer', sdp: data.answer })
    if (data.offer) {
      await pc.setRemoteDescription({ type: 'offer', sdp: data.offer })
      await pc.setLocalDescription(await pc.createAnswer())
    }
    await api.fbwebCallAction(c.account, c.call_id, 'subscribe', { tracks: Array.isArray(data.tracks) ? data.tracks : [] })
    if (my !== seq) return { ok: false, reason: '', error: '' }
    fbwebCall.state = 'in_call'
    fbwebCall.answeredAt = Date.now()
    return { ok: true, reason: '', error: '' }
  } catch (error) {
    const msg = errorOf(error)
    if (my === seq) {
      // Đã gửi lời tham gia mà hỏng giữa chừng: cúp để khách không chờ một máy câm.
      if (pc) api.fbwebCallAction(c.account, c.call_id, 'hangup', {}).catch(() => {})
      cleanup()
    }
    return { ok: false, reason: '', error: msg }
  }
}

// Tắt chuông trên Libredesk (khách vẫn nghe chuông tới khi Facebook thôi).
export async function declineFbwebCall (c) {
  try {
    await api.fbwebCallAction(c.account, c.call_id, 'decline', {})
    return { ok: true, error: '' }
  } catch (error) {
    return { ok: false, error: errorOf(error) }
  }
}

export async function hangupFbwebCall () {
  if (fbwebCall.state === 'idle') return
  const { account, callId } = fbwebCall
  seq++
  cleanup()
  try {
    await api.fbwebCallAction(account, callId, 'hangup', {})
  } catch {
    // Cuộc gọi đã kết thúc phía Facebook: không có gì để báo.
  }
}

export function toggleFbwebMute () {
  if (!mic) return
  fbwebCall.muted = !fbwebCall.muted
  mic.getAudioTracks().forEach((t) => { t.enabled = !fbwebCall.muted })
}

// Danh sách cuộc gọi mới của gateway: cuộc đang nói không còn trong đó thì khách đã cúp.
export function syncFbwebCall (list) {
  if (fbwebCall.state !== 'in_call') return
  if (!list.some((c) => fbwebKey(c) === fbwebCall.key)) {
    seq++
    cleanup()
  }
}
