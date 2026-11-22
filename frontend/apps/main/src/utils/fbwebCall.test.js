// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = []
// waits: trạng thái lần lượt mà wait trả (cuộc gọi đi).
let waits = []
async function defaultAction (account, callId, action, body) {
  calls.push({ account, callId, action, body })
  if (action === 'answer') {
    return { data: { answer: 'v=0 answer', offer: 'v=0 reoffer', tracks: [{ id: 'a1', video: false, on: true }] } }
  }
  if (action === 'wait') {
    await new Promise((r) => setTimeout(r, 5))
    return { data: waits.length ? waits.shift() : { state: 'ringing' } }
  }
  return { data: { ok: true } }
}
const fbwebCallAction = vi.fn(defaultAction)
const startFbwebCall = vi.fn(async (uuid, offer) => {
  calls.push({ action: 'start', uuid, offer })
  return { data: { account: 'vetgo-test', call_id: 'ROOM:9', answer: 'v=0 answer' } }
})
vi.mock('@main/api', () => ({ default: { fbwebCallAction: (...a) => fbwebCallAction(...a), startFbwebCall: (...a) => startFbwebCall(...a) } }))

const {
  answerFbwebCall, callFbwebCustomer, cameraState, decodedFrames, fbwebAccountOf, fbwebCall, fbwebKey, fbwebVideo,
  hangupFbwebCall, isFbwebCall, isFbwebSilenced, pruneFbwebSilenced, silenceFbwebCall, syncFbwebCall, toggleFbwebMute
} =
  await import('./fbwebCall.js')

// RTCPeerConnection giả: ghi các bước để kiểm thứ tự như cửa sổ cuộc gọi của Business Suite.
class FakePC {
  constructor (cfg) {
    FakePC.last = this
    this.cfg = cfg
    this.steps = []
    this.connectionState = 'new'
  }
  addTrack () { this.steps.push('addTrack') }
  addTransceiver (kind, opts) { this.steps.push(`transceiver:${kind}:${opts.direction}`) }
  createDataChannel () { this.steps.push('datachannel') }
  async createOffer () { return { type: 'offer', sdp: 'v=0\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n' } }
  async createAnswer () { return { type: 'answer', sdp: 'v=0 local answer' } }
  async setLocalDescription (d) { this.localDescription = d; this.steps.push(`local:${d.type}`) }
  async setRemoteDescription (d) { this.steps.push(`remote:${d.type}:${d.sdp}`) }
  close () { this.steps.push('close') }
  // Báo cáo getStats: frames là số khung hình video đã giải mã của khách.
  async getStats () {
    return new Map([['v', { type: 'inbound-rtp', kind: 'video', trackIdentifier: 'cam', framesDecoded: this.frames || 0 }]])
  }
}

const track = { enabled: true, stop: vi.fn() }
const stream = { getAudioTracks: () => [track], getTracks: () => [track] }
const ring = { channel: 'fb-bridge-web', account: 'vetgo-test', call_id: 'ROOM:1', conversation_uuid: 'u1', incoming: true, state: 'ringing' }

beforeEach(() => {
  calls.length = 0
  waits = []
  fbwebCallAction.mockClear()
  window.RTCPeerConnection = FakePC
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => stream) }, configurable: true })
})

afterEach(async () => {
  await hangupFbwebCall()
})

describe('Fanpage Web calls', () => {
  it('reads the Page from the inbox name and recognises its calls', () => {
    expect(fbwebAccountOf({ inbox_name: 'Fanpage Web - vetgo-test' })).toBe('vetgo-test')
    expect(fbwebAccountOf({ inbox_name: 'Fanpage - vetgo' })).toBe('')
    expect(fbwebAccountOf(null)).toBe('')
    expect(isFbwebCall(ring)).toBe(true)
    expect(isFbwebCall({ channel: 'sms' })).toBe(false)
    expect(fbwebKey(ring)).toBe('vetgo-test:ROOM:1')
  })

  it('answers like the Business Suite call window', async () => {
    const res = await answerFbwebCall(ring)
    expect(res.ok).toBe(true)
    const pc = FakePC.last
    expect(pc.cfg.iceServers).toEqual([{ urls: 'stun:stun.fbsbx.com:3478' }])
    expect(pc.cfg.iceTransportPolicy).toBeUndefined()
    expect(pc.steps).toEqual([
      'addTrack', 'transceiver:video:recvonly', 'datachannel', 'local:offer',
      'remote:answer:v=0 answer', 'remote:offer:v=0 reoffer', 'local:answer'
    ])
    // Tham số Opus như Business Suite; answer của offer mới không gửi đi.
    expect(calls.map((c) => c.action)).toEqual(['answer', 'subscribe'])
    expect(calls[0].body.offer).toContain('a=fmtp:111 minptime=10;useinbandfec=0;stereo=0;usedtx=1;maxaveragebitrate=20000;maxplaybackrate=16000')
    expect(calls[1].body.tracks).toEqual([{ id: 'a1', video: false, on: true }])
    expect(fbwebCall.state).toBe('in_call')
    expect(fbwebCall.conversationUUID).toBe('u1')

    // Đang nghe một cuộc thì không nghe cuộc khác.
    expect((await answerFbwebCall({ ...ring, call_id: 'ROOM:2' })).reason).toBe('busy')

    toggleFbwebMute()
    expect(fbwebCall.muted).toBe(true)
    expect(track.enabled).toBe(false)

    await hangupFbwebCall()
    expect(calls.at(-1).action).toBe('hangup')
    expect(fbwebCall.state).toBe('idle')
    expect(pc.steps.at(-1)).toBe('close')
  })

  it('stops when the call leaves the gateway list (the customer hung up)', async () => {
    await answerFbwebCall(ring)
    syncFbwebCall([ring])
    expect(fbwebCall.state).toBe('in_call')
    syncFbwebCall([])
    expect(fbwebCall.state).toBe('idle')
    expect(calls.map((c) => c.action)).toEqual(['answer', 'subscribe'])
  })

  it('sends ring_id and stops, without hanging up, when the customer calls back on the same room', async () => {
    const first = { ...ring, ring_id: 'r-1' }
    await answerFbwebCall(first)
    expect(calls.map((c) => c.body.ring_id)).toEqual(['r-1', 'r-1'])
    syncFbwebCall([{ ...first, state: 'active' }])
    expect(fbwebCall.state).toBe('in_call')
    // Khách cúp rồi gọi lại trước lần hỏi danh sách kế tiếp: cùng phòng, ring_id mới.
    syncFbwebCall([{ ...first, ring_id: 'r-2', state: 'ringing' }])
    expect(fbwebCall.state).toBe('idle')
    expect(calls.map((c) => c.action)).toEqual(['answer', 'subscribe'])
  })

  it('hangs up with the ring_id of the call it joined', async () => {
    await answerFbwebCall({ ...ring, ring_id: 'r-1' })
    await hangupFbwebCall()
    expect(calls.at(-1)).toMatchObject({ action: 'hangup', body: { ring_id: 'r-1' } })
  })

  it('reports a missing microphone without answering', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => { throw new Error('denied') })
    const res = await answerFbwebCall(ring)
    expect(res).toEqual({ ok: false, reason: 'mic', error: '' })
    expect(calls).toEqual([])
    expect(fbwebCall.state).toBe('idle')
  })

  it('does not hang up when the answer is refused (a colleague has the call), with the gateway reason', async () => {
    for (const [status, msg] of [
      [409, 'Một nhân viên khác đang nghe máy cuộc gọi này.'],
      [422, 'Không thực hiện được: cuộc gọi đã được nghe trên Libredesk.'],
      [404, 'Cuộc gọi đã kết thúc.']
    ]) {
      calls.length = 0
      fbwebCallAction.mockImplementationOnce(async () => {
        const error = new Error(String(status))
        error.response = { status, data: { error: msg } }
        throw error
      })
      const res = await answerFbwebCall(ring)
      expect(res).toEqual({ ok: false, reason: '', error: msg })
      // Cúp lúc này sẽ cắt cuộc gọi của đồng nghiệp trên cùng phiên Trang.
      expect(calls).toEqual([])
      expect(fbwebCall.state).toBe('idle')
    }
  })

  it('hangs up when the call breaks after joining, or when the join may have happened', async () => {
    // Đã tham gia, subscribe hỏng: cúp để khách không chờ một máy câm.
    fbwebCallAction.mockImplementation(async (account, callId, action, body) => {
      calls.push({ account, callId, action, body })
      if (action === 'answer') return { data: { answer: 'v=0 answer', offer: 'v=0 reoffer', tracks: [] } }
      if (action === 'subscribe') {
        const error = new Error('422')
        error.response = { status: 422, data: { error: 'Không thực hiện được: Facebook từ chối.' } }
        throw error
      }
      return { data: { ok: true } }
    })
    try {
      let res = await answerFbwebCall(ring)
      expect(res.ok).toBe(false)
      expect(calls.map((c) => c.action)).toEqual(['answer', 'subscribe', 'hangup'])

      // Gateway hết giờ chờ Facebook (504): có thể đã tham gia, nên vẫn cúp.
      calls.length = 0
      fbwebCallAction.mockImplementation(async (account, callId, action, body) => {
        calls.push({ account, callId, action, body })
        if (action === 'answer') {
          const error = new Error('504')
          error.response = { status: 504, data: { error: 'Facebook không trả lời kịp.' } }
          throw error
        }
        return { data: { ok: true } }
      })
      res = await answerFbwebCall(ring)
      expect(res.error).toBe('Facebook không trả lời kịp.')
      expect(calls.map((c) => c.action)).toEqual(['answer', 'hangup'])
      expect(fbwebCall.state).toBe('idle')
    } finally {
      fbwebCallAction.mockReset()
      fbwebCallAction.mockImplementation(defaultAction)
    }
  })

  it('silences a ringing call on this browser only, without telling the gateway', () => {
    const first = { ...ring, since: '2026-11-22T10:00:00Z' }
    silenceFbwebCall(first)
    expect(isFbwebSilenced(first)).toBe(true)
    expect(calls).toEqual([])
    expect(fbwebCallAction).not.toHaveBeenCalled()

    // Còn đổ chuông: vẫn tắt. Lời mời mới cùng mã phòng (since mới) thì đổ chuông lại.
    pruneFbwebSilenced([first])
    expect(isFbwebSilenced(first)).toBe(true)
    const again = { ...ring, since: '2026-11-22T10:05:00Z' }
    expect(isFbwebSilenced(again)).toBe(false)

    // Hết đổ chuông (rời danh sách hay đã nghe máy): quên.
    pruneFbwebSilenced([{ ...first, state: 'active' }])
    expect(isFbwebSilenced(first)).toBe(false)
  })
})

describe('Fanpage Web outgoing calls', () => {
  const conv = { uuid: 'u1' }

  it('calls, waits for the customer to answer, then follows the call to its end', async () => {
    waits = [{ state: 'ringing' }, { state: 'answered', offer: 'v=0 reoffer' }, { state: 'ringing' }, { state: 'ended' }]
    const res = await callFbwebCustomer(conv)
    expect(res).toEqual({ ok: true, reason: 'done', error: '' })
    expect(calls[0].action).toBe('start')
    expect(calls[0].offer).toContain('maxaveragebitrate=20000')
    expect(calls.slice(1).every((c) => c.action === 'wait' && c.callId === 'ROOM:9')).toBe(true)
    // SDP answer khi gọi, rồi offer mới khi khách nghe máy (answer của nó không gửi đi).
    expect(FakePC.last.steps).toContain('remote:answer:v=0 answer')
    expect(FakePC.last.steps).toContain('remote:offer:v=0 reoffer')
    expect(fbwebCall.state).toBe('idle')
  })

  it('hangs up by itself when the customer does not answer', async () => {
    const res = await callFbwebCustomer(conv, 20)
    expect(res.reason).toBe('no_answer')
    expect(calls.at(-1).action).toBe('hangup')
    expect(fbwebCall.state).toBe('idle')
  })

  it('reports a call that ends before the customer answers', async () => {
    waits = [{ state: 'ended' }]
    expect((await callFbwebCustomer(conv)).reason).toBe('ended')
    expect(calls.some((c) => c.action === 'hangup')).toBe(false)
  })

  it('shows the gateway reason when the Page cannot call', async () => {
    startFbwebCall.mockImplementationOnce(async () => {
      const error = new Error('422')
      error.response = { data: { error: 'Không thực hiện được: Trang chưa nhận cuộc gọi nào.' } }
      throw error
    })
    const res = await callFbwebCustomer(conv)
    expect(res).toEqual({ ok: false, reason: '', error: 'Không thực hiện được: Trang chưa nhận cuộc gọi nào.' })
    expect(fbwebCall.state).toBe('idle')
  })

  it('sends the ring_id of the call it placed, and stops when the room moved on (409)', async () => {
    startFbwebCall.mockImplementationOnce(async (uuid, offer) => {
      calls.push({ action: 'start', uuid, offer })
      return { data: { account: 'vetgo-test', call_id: 'ROOM:9', ring_id: 'r-9', answer: 'v=0 answer' } }
    })
    fbwebCallAction.mockImplementationOnce(async (account, callId, action, body) => {
      calls.push({ account, callId, action, body })
      const error = new Error('409')
      error.response = { status: 409, data: { error: 'Cuộc gọi này đã kết thúc, khách đang gọi lại.' } }
      throw error
    })
    const res = await callFbwebCustomer(conv)
    expect(res.reason).toBe('ended')
    expect(calls[1]).toMatchObject({ action: 'wait', body: { ring_id: 'r-9' } })
    expect(calls.some((c) => c.action === 'hangup')).toBe(false)
  })

  it('stops ringing when the agent hangs up', async () => {
    const pending = callFbwebCustomer(conv)
    await new Promise((r) => setTimeout(r, 20))
    expect(fbwebCall.state).toBe('ringing_out')
    await hangupFbwebCall()
    expect((await pending).reason).toBe('hangup')
    expect(calls.filter((c) => c.action === 'hangup').length).toBe(1)
  })
})

describe('Fanpage Web customer camera', () => {
  it('counts decoded frames of the customer video track only', () => {
    const report = new Map([
      ['a', { type: 'inbound-rtp', kind: 'audio', trackIdentifier: 'mic', framesDecoded: 99 }],
      ['v', { type: 'inbound-rtp', kind: 'video', trackIdentifier: 'cam', framesDecoded: 12 }],
      ['o', { type: 'inbound-rtp', kind: 'video', trackIdentifier: 'other', framesDecoded: 50 }]
    ])
    expect(decodedFrames(report, 'cam')).toBe(12)
    expect(decodedFrames(new Map(), 'cam')).toBe(0)
    expect(decodedFrames(null, 'cam')).toBe(0)
  })

  it('turns the camera off after no new frames for two seconds', () => {
    let st = { frames: 0, at: 0, on: false }
    st = cameraState(st, 0, 1000)
    expect(st.on).toBe(false) // track live nhưng chưa có khung hình: camera tắt
    st = cameraState(st, 30, 2000)
    expect(st).toEqual({ frames: 30, at: 2000, on: true })
    st = cameraState(st, 30, 3000)
    expect(st.on).toBe(true) // mới 1 giây không có khung mới
    st = cameraState(st, 30, 4000)
    expect(st.on).toBe(false)
    st = cameraState(st, 31, 5000)
    expect(st.on).toBe(true)
  })

  it('follows getStats while in a call and stops on hangup', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('MediaStream', class { constructor (tracks) { this.tracks = tracks } })
    try {
      await answerFbwebCall(ring)
      const pc = FakePC.last
      pc.ontrack({ track: { kind: 'video', id: 'cam' }, transceiver: { mid: '3' }, streams: [] })
      expect(fbwebVideo.remote.value).not.toBeNull()

      pc.frames = 10
      await vi.advanceTimersByTimeAsync(1000)
      expect(fbwebCall.remoteVideo).toBe(true)
      // Khách tắt camera: track vẫn live, khung hình đứng yên.
      await vi.advanceTimersByTimeAsync(3000)
      expect(fbwebCall.remoteVideo).toBe(false)
      pc.frames = 20
      await vi.advanceTimersByTimeAsync(1000)
      expect(fbwebCall.remoteVideo).toBe(true)

      await hangupFbwebCall()
      expect(fbwebCall.remoteVideo).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
