// Âm thanh cuộc gọi của điện thoại chi nhánh trong trình duyệt (omnichannel docs/plan-sms-call.md, P5).
// WebSocket /gw/branch-calls/{chi nhánh}/{cuộc gọi}/audio: PCM 16 kHz mono 16 bit, khung 20 ms, hai
// chiều (gateway -> sms-bridge -> Vetgo Phone Desktop -> CallAudio qua cáp USB). Worklet giống trang
// "Điện thoại qua web" của vglink (web/phone.html). Singleton cấp module: đổi hội thoại vẫn nghe tiếp.
import { reactive } from 'vue'

export const branchAudio = reactive({
  // account + ':' + call_id của cuộc gọi đang nghe trên máy tính, '' nếu không.
  key: '',
  // idle | connecting | on
  status: 'idle',
  muted: false,
  // Lý do lần mở gần nhất không được (gateway/agent gửi tiếng Việt qua close 4001).
  error: ''
})

// Hội thoại vừa bấm Nghe máy / 📞: tự chuyển tiếng sang máy tính khi cuộc gọi bắt đầu nói.
export const audioWanted = reactive({})

const WORKLET = `
class Bridge extends AudioWorkletProcessor {
  constructor() {
    super(); this.q = []; this.queued = 0; this.cur = null; this.pos = 0; this.started = false;
    this.ratio = sampleRate / 16000; this.acc = 0; this.sum = 0; this.n = 0; this.mic = new Float32Array(320); this.m = 0;
    this.port.onmessage = e => {
      this.q.push(e.data); this.queued += e.data.length;
      while (this.queued > sampleRate * 0.25 && this.q.length > 1) { this.queued -= this.q.shift().length; }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!this.started && this.queued >= sampleRate * 0.06) this.started = true;
    for (let i = 0; i < out.length; i++) {
      if (!this.cur || this.pos >= this.cur.length) {
        this.cur = this.started ? (this.q.shift() || null) : null; this.pos = 0;
        if (this.cur) this.queued -= this.cur.length; else this.started = false;
      }
      out[i] = this.cur ? this.cur[this.pos++] : 0;
    }
    const inp = inputs[0] && inputs[0][0];
    if (inp) for (let i = 0; i < inp.length; i++) {
      this.sum += inp[i]; this.n++; this.acc++;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio; this.mic[this.m++] = this.sum / this.n; this.sum = 0; this.n = 0;
        if (this.m === 320) {
          const b = new Int16Array(320);
          for (let j = 0; j < 320; j++) b[j] = Math.max(-1, Math.min(1, this.mic[j])) * 32767;
          this.port.postMessage(b.buffer, [b.buffer]); this.m = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("bridge", Bridge);`

let ctx = null
let node = null
let micSource = null
let micStream = null
let ws = null

// PCM 16 kHz -> Float32 ở tần số của AudioContext (nội suy tuyến tính).
export function upsample(pcm, rate) {
  const n = Math.round((pcm.length * rate) / 16000)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 16000) / rate
    const j = Math.floor(x)
    const f = x - j
    const a = pcm[j] || 0
    const b = pcm[Math.min(j + 1, pcm.length - 1)] || 0
    out[i] = (a + (b - a) * f) / 32768
  }
  return out
}

// Gọi trong lúc người dùng bấm nút: trình duyệt chỉ cho phát tiếng sau một thao tác.
export async function prepareAudio() {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return false
  if (!ctx) ctx = new AC()
  if (ctx.state !== 'running') await ctx.resume().catch(() => {})
  return true
}

async function ensureNodes() {
  if (!node) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    node = new AudioWorkletNode(ctx, 'bridge', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    node.connect(ctx.destination)
    node.port.onmessage = (e) => {
      if (ws && ws.readyState === 1 && !branchAudio.muted) ws.send(e.data)
    }
  }
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    })
    micSource = ctx.createMediaStreamSource(micStream)
    micSource.connect(node)
  }
}

function releaseMic() {
  micSource?.disconnect()
  micSource = null
  micStream?.getTracks().forEach((t) => t.stop())
  micStream = null
}

// Nghe và nói cuộc gọi `c` ({account, call_id}) trên máy tính. Trả '' hoặc lý do không được.
export async function startBranchAudio(c) {
  const key = `${c.account}:${c.call_id}`
  if (branchAudio.key === key && branchAudio.status !== 'idle') return ''
  stopBranchAudio()
  Object.assign(branchAudio, { key, status: 'connecting', muted: false, error: '' })
  if (!window.isSecureContext || !navigator.mediaDevices || !(await prepareAudio())) {
    return fail(key, 'insecure')
  }
  try {
    await ensureNodes()
  } catch {
    return fail(key, 'mic')
  }
  if (branchAudio.key !== key) return ''
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  const sock = new WebSocket(
    `${scheme}://${location.host}/gw/branch-calls/${encodeURIComponent(c.account)}/${encodeURIComponent(c.call_id)}/audio`
  )
  sock.binaryType = 'arraybuffer'
  ws = sock
  return new Promise((resolve) => {
    let settled = false
    const settle = (v) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    sock.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer) || !node) return
      if (branchAudio.status === 'connecting') {
        branchAudio.status = 'on'
        settle('')
      }
      const out = upsample(new Int16Array(e.data), ctx.sampleRate)
      node.port.postMessage(out, [out.buffer])
    }
    sock.onclose = (e) => {
      if (ws !== sock) return settle('')
      ws = null
      const reason = e.code >= 4000 && e.code < 5000 ? e.reason : ''
      releaseMic()
      Object.assign(branchAudio, { key: '', status: 'idle', error: reason })
      settle(reason || (branchAudio.status === 'on' ? '' : 'error'))
    }
  })
}

function fail(key, why) {
  if (branchAudio.key === key) Object.assign(branchAudio, { key: '', status: 'idle', error: why })
  releaseMic()
  return why
}

// Tiếng về lại điện thoại (cuộc gọi vẫn tiếp tục).
export function stopBranchAudio() {
  const sock = ws
  ws = null
  sock?.close()
  releaseMic()
  Object.assign(branchAudio, { key: '', status: 'idle', muted: false })
}

export function toggleBranchMute() {
  branchAudio.muted = !branchAudio.muted
}
