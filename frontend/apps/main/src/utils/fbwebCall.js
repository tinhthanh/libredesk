// Cuộc gọi Fanpage Web trong Libredesk (omnichannel docs/plan-fbweb-call.md, P3 nghe máy, P4 gọi khách).
// Khách gọi Trang qua Messenger, hoặc Trang gọi khách; trình duyệt nói WebRTC thẳng với máy chủ media của
// Meta (ice-lite, STUN của Meta, không TURN). Gateway chỉ chuyển SDP.
// Cùng cách cửa sổ cuộc gọi của Business Suite (fbweb-ls/calltest.html, thử thật 18/11/2026):
//   audio gửi và nhận, video chỉ nhận (camera của khách), một data channel.
//   Nghe máy: server trả SDP answer rồi SDP offer mới thêm luồng của khách, trình duyệt áp cả hai
//   (answer của offer này không gửi đi), sau đó gateway báo nhận luồng (subscribe).
//   Gọi khách: server trả SDP answer; khi khách nghe máy, wait trả SDP offer mới thêm luồng của khách.
//   Facebook không báo khách không nghe máy: sau OUTGOING_RING_MS thì tự cúp.
// Trạng thái là singleton ở cấp module: đổi hội thoại thì cuộc gọi vẫn tiếp tục.
import { reactive, shallowRef } from 'vue'
import api from '@main/api'
import {
  CAMERA_POLL_MS,
  OUTGOING_RING_MS,
  cameraState,
  decodedFrames,
  fbwebCallGone,
  fbwebKey,
  fbwebSilenceKey as silenceKey,
  inboxAccount,
  liveSilenceKeys,
  withRing
} from '@omni-core'

// Hằng số và quy tắc thuần (khoá cuộc gọi, ring_id, đếm khung hình camera) nằm ở omni-core, dùng chung
// với app Vetgo. Camera của khách: Facebook giữ track video live và không mute khi khách tắt camera, nên
// đếm khung hình đã giải mã (getStats); không có khung mới trong CAMERA_IDLE_MS thì coi là camera tắt.
export {
  FBWEB_CHANNEL,
  OUTGOING_RING_MS,
  CAMERA_POLL_MS,
  CAMERA_IDLE_MS,
  fbwebKey,
  isFbwebCall,
  decodedFrames,
  cameraState
} from '@omni-core'

export const fbwebCall = reactive({
  key: '', // `${account}:${call_id}` như danh sách cuộc gọi của gateway
  account: '',
  callId: '',
  // ring_id của gateway: một giá trị cho mỗi lần gọi. Messenger dùng lại mã phòng (call_id) cho mọi
  // cuộc gọi giữa khách và Trang; gửi kèm ring_id để thao tác của cuộc cũ không chạm cuộc khách gọi lại.
  ringId: '',
  conversationUUID: '',
  // idle | answering | calling (đang mở cuộc gọi đi) | ringing_out (đang đổ chuông ở khách) | in_call
  state: 'idle',
  outgoing: false,
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
let cameraTimer = null

// Tên Trang của hội thoại Fanpage Web: inbox gateway đặt tên "Fanpage Web - <tài khoản>".
export function fbwebAccountOf (conversation) {
  return inboxAccount(conversation, 'fanpage-web')
}

export function fbwebSupported () {
  return typeof window !== 'undefined' && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia
}

function munge (sdp) {
  return sdp.replace(/a=fmtp:111 [^\r\n]*/, 'a=fmtp:111 ' + OPUS_FMTP)
}

function stopCameraWatch () {
  clearInterval(cameraTimer)
  cameraTimer = null
}

function watchCamera (track) {
  stopCameraWatch()
  const peer = pc
  let state = { frames: 0, at: Date.now(), on: false }
  cameraTimer = setInterval(async () => {
    if (pc !== peer) return stopCameraWatch()
    try {
      const report = await peer.getStats()
      state = cameraState(state, decodedFrames(report, track.id), Date.now())
      if (pc === peer) fbwebCall.remoteVideo = state.on
    } catch {
      // getStats lỗi một lần (peer đang đóng): lần sau thử lại.
    }
  }, CAMERA_POLL_MS)
}

function cleanup () {
  stopCameraWatch()
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
  Object.assign(fbwebCall, {
    key: '', account: '', callId: '', ringId: '', conversationUUID: '', state: 'idle', outgoing: false, muted: false, remoteVideo: false, answeredAt: 0
  })
}

// Lỗi của gateway là tiếng Việt cho nhân viên; '' -> câu chung của nơi gọi.
const errorOf = (error) => error?.response?.data?.error || ''

// openPeer: micro và RTCPeerConnection như cửa sổ cuộc gọi của Business Suite; trả SDP offer đã áp.
async function openPeer () {
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
      watchCamera(e.track)
    }
  }
  pc.onconnectionstatechange = () => {
    if (pc && pc.connectionState === 'failed') hangupFbwebCall()
  }
  const offer = await pc.createOffer()
  await pc.setLocalDescription({ type: 'offer', sdp: munge(offer.sdp) })
  return pc.localDescription.sdp
}

// applyServerOffer: SDP offer mới của server (luồng của khách); answer không gửi đi (ice-lite).
async function applyServerOffer (sdp) {
  if (!sdp || !pc) return
  await pc.setRemoteDescription({ type: 'offer', sdp })
  await pc.setLocalDescription(await pc.createAnswer())
}

async function getMic () {
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true })
    return true
  } catch {
    return false
  }
}

// answerFbwebCall nghe máy cuộc gọi c (một mục của GET /gw/calls/ringing).
// Trả { ok, error, reason }: reason 'mic' (không có micro), 'insecure' (trang không phải https/localhost), 'busy'.
export async function answerFbwebCall (c) {
  if (fbwebCall.state !== 'idle') return { ok: false, reason: 'busy', error: '' }
  if (!window.isSecureContext) return { ok: false, reason: 'insecure', error: '' }
  const my = ++seq
  Object.assign(fbwebCall, {
    key: fbwebKey(c), account: c.account, callId: c.call_id, ringId: c.ring_id || '', conversationUUID: c.conversation_uuid || '', state: 'answering'
  })
  const ringId = c.ring_id || ''
  if (!(await getMic())) {
    if (my === seq) cleanup()
    return { ok: false, reason: 'mic', error: '' }
  }
  let joined = false
  try {
    const offer = await openPeer()
    const { data } = await api.fbwebCallAction(c.account, c.call_id, 'answer', withRing({ offer }, ringId))
    joined = true
    if (my !== seq || !pc) return { ok: false, reason: '', error: '' }
    await pc.setRemoteDescription({ type: 'answer', sdp: data.answer })
    await applyServerOffer(data.offer)
    await api.fbwebCallAction(c.account, c.call_id, 'subscribe', withRing({ tracks: Array.isArray(data.tracks) ? data.tracks : [] }, ringId))
    if (my !== seq) return { ok: false, reason: '', error: '' }
    fbwebCall.state = 'in_call'
    fbwebCall.answeredAt = Date.now()
    return { ok: true, reason: '', error: '' }
  } catch (error) {
    const msg = errorOf(error)
    if (my === seq) {
      // Lời tham gia bị từ chối (404 đã kết thúc, 409 đồng nghiệp đang hay đã nghe máy, 422 agent từ
      // chối): mình chưa tham gia, và cúp lúc này là cúp phòng trên phiên Trang dùng chung, cắt cuộc
      // gọi của đồng nghiệp. Chỉ cúp khi đã tham gia (hay có thể đã tham gia: lỗi mạng, 5xx) mà hỏng
      // giữa chừng, để khách không chờ một máy câm.
      const status = error?.response?.status || 0
      const refused = !joined && status >= 400 && status < 500
      if (pc && !refused) api.fbwebCallAction(c.account, c.call_id, 'hangup', withRing({}, ringId)).catch(() => {})
      cleanup()
    }
    return { ok: false, reason: '', error: msg }
  }
}

// callFbwebCustomer: Trang gọi khách của hội thoại. Trả khi cuộc gọi kết thúc (hay không gọi được):
// { ok, reason, error } với reason 'mic' | 'insecure' | 'busy' | 'no_answer' | 'ended' (khách từ chối
// hay cuộc gọi kết thúc trước khi nghe máy) | 'done' (đã nói chuyện) | 'hangup' (nhân viên cúp).
export async function callFbwebCustomer (conversation, ringMs = OUTGOING_RING_MS) {
  if (fbwebCall.state !== 'idle') return { ok: false, reason: 'busy', error: '' }
  if (!window.isSecureContext) return { ok: false, reason: 'insecure', error: '' }
  const my = ++seq
  Object.assign(fbwebCall, { conversationUUID: conversation.uuid, state: 'calling', outgoing: true })
  if (!(await getMic())) {
    if (my === seq) cleanup()
    return { ok: false, reason: 'mic', error: '' }
  }
  let started
  try {
    const offer = await openPeer()
    const { data } = await api.startFbwebCall(conversation.uuid, offer)
    if (my !== seq || !pc) {
      api.fbwebCallAction(data.account, data.call_id, 'hangup', withRing({}, data.ring_id)).catch(() => {})
      return { ok: false, reason: 'hangup', error: '' }
    }
    Object.assign(fbwebCall, {
      key: `${data.account}:${data.call_id}`, account: data.account, callId: data.call_id, ringId: data.ring_id || '', state: 'ringing_out'
    })
    await pc.setRemoteDescription({ type: 'answer', sdp: data.answer })
    started = Date.now()
  } catch (error) {
    if (my === seq) cleanup()
    return { ok: false, reason: '', error: errorOf(error) }
  }
  const { account, callId, ringId } = fbwebCall
  // Chờ khách nghe máy, rồi chờ cuộc gọi kết thúc (wait giữ tới khi có chuyện hay hết hạn).
  let errors = 0
  while (my === seq) {
    if (fbwebCall.state === 'ringing_out' && Date.now() - started >= ringMs) {
      await hangupFbwebCall()
      return { ok: false, reason: 'no_answer', error: '' }
    }
    let u
    try {
      ;({ data: u } = await api.fbwebCallAction(account, callId, 'wait', withRing({}, ringId)))
      errors = 0
    } catch (error) {
      if (my !== seq) break
      // 404: cuộc gọi đã kết thúc; 409: phòng đã sang một cuộc gọi khác.
      const status = error?.response?.status
      if (++errors >= 3 || status === 404 || status === 409) {
        cleanup()
        return { ok: false, reason: 'ended', error: '' }
      }
      continue
    }
    if (my !== seq) break
    if (u.state === 'answered' && fbwebCall.state === 'ringing_out') {
      try {
        await applyServerOffer(u.offer)
      } catch {
        await hangupFbwebCall()
        return { ok: false, reason: '', error: '' }
      }
      fbwebCall.state = 'in_call'
      fbwebCall.answeredAt = Date.now()
    } else if (u.state === 'ended') {
      const talked = fbwebCall.state === 'in_call'
      cleanup()
      return { ok: talked, reason: talked ? 'done' : 'ended', error: '' }
    }
  }
  return { ok: true, reason: 'hangup', error: '' }
}

// Tắt chuông chỉ trên trình duyệt này, không gửi gì lên gateway: thao tác decline của gateway
// là cúp phía Trang, làm cuộc gọi biến mất khỏi Libredesk của mọi nhân viên, trong khi nhân viên
// khác có thể vẫn muốn nghe máy (như app Vetgo). Khách vẫn nghe chuông tới khi Facebook thôi.
// Khoá kèm `since`: Messenger dùng lại mã phòng cho mọi cuộc gọi giữa khách và Trang, lời mời mới
// có `since` mới nên đổ chuông lại.
const silenced = reactive(new Set())

export function silenceFbwebCall (c) {
  silenced.add(silenceKey(c))
}

export function isFbwebSilenced (c) {
  return silenced.has(silenceKey(c))
}

// Quên các cuộc đã tắt chuông khi chúng không còn đổ chuông trong danh sách mới của gateway.
export function pruneFbwebSilenced (list) {
  const live = liveSilenceKeys(list)
  for (const k of silenced) if (!live.has(k)) silenced.delete(k)
}

export async function hangupFbwebCall () {
  if (fbwebCall.state === 'idle') return
  const { account, callId, ringId } = fbwebCall
  seq++
  cleanup()
  if (!callId) return
  try {
    // Kèm ring_id: khách vừa cúp rồi gọi lại (cùng phòng) thì gateway trả 409, không cúp cuộc mới.
    await api.fbwebCallAction(account, callId, 'hangup', withRing({}, ringId))
  } catch {
    // Cuộc gọi đã kết thúc phía Facebook: không có gì để báo.
  }
}

export function toggleFbwebMute () {
  if (!mic) return
  fbwebCall.muted = !fbwebCall.muted
  mic.getAudioTracks().forEach((t) => { t.enabled = !fbwebCall.muted })
}

// Danh sách cuộc gọi mới của gateway: cuộc đang nói (khách gọi tới) không còn trong đó thì khách đã cúp.
// Còn phòng đó nhưng ring_id khác thì khách đã cúp rồi gọi lại (Messenger dùng lại mã phòng): cuộc
// đang nói cũng đã hết, cuộc mới đổ chuông như mọi cuộc khác. Không gửi cúp: phòng đã kết thúc
// trên gateway, và lệnh cúp lúc này sẽ cúp cuộc khách vừa gọi lại.
// Cuộc gọi đi tự theo dõi qua wait.
export function syncFbwebCall (list) {
  if (fbwebCall.state !== 'in_call' || fbwebCall.outgoing) return
  if (fbwebCallGone(list, fbwebCall.key, fbwebCall.ringId)) {
    seq++
    cleanup()
  }
}
