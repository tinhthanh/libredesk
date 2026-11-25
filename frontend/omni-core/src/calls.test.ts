import { describe, expect, it } from 'vitest'
import {
  DIAL_WAIT_MS,
  accountListed,
  branchCallFor,
  callStatusCode,
  cameraState,
  decodedFrames,
  fbwebCallGone,
  fbwebKey,
  fbwebSilenceKey,
  formatCallDuration,
  inboxAccount,
  isCallActive,
  isFbwebCall,
  liveSilenceKeys,
  needsCable,
  pruneDialing,
  secondsSince,
  upsample,
  withRing
} from './index'

describe('inbox accounts', () => {
  it('reads the account after the channel prefix', () => {
    expect(inboxAccount({ inbox_name: 'Zalo - acc2' })).toBe('acc2')
    expect(inboxAccount({ inbox_name: 'Zalo OA - shop' }, 'zalo')).toBe('')
    expect(inboxAccount({ inbox_name: 'Zalo OA - shop' }, 'zalo-oa')).toBe('shop')
    expect(inboxAccount({ inbox_name: 'Fanpage Web - vetgo' }, 'fanpage-web')).toBe('vetgo')
    expect(inboxAccount({ inbox_name: 'Fanpage Web - vetgo' }, 'fanpage')).toBe('')
    expect(inboxAccount({ inbox_name: 'SMS - q1' }, 'sms')).toBe('q1')
    expect(inboxAccount({ inbox_name: 'Support' })).toBe('')
    expect(inboxAccount(null)).toBe('')
  })

  it('matches omi account names with the clinic slug', () => {
    expect(accountListed(['t.q7', 'q1'], 'q7')).toBe(true)
    expect(accountListed(['t.q7', 'q1'], 'q1')).toBe(true)
    expect(accountListed(['t.q7'], 'q')).toBe(false)
    expect(accountListed(null, 'q7')).toBe(false)
    expect(accountListed(['q7'], '')).toBe(false)
  })
})

describe('call status', () => {
  it('codes states and known end reasons', () => {
    expect(callStatusCode('ringing')).toBe('state.ringing')
    expect(callStatusCode('')).toBe('state.idle')
    expect(callStatusCode('ended', 'no_answer')).toBe('end.no_answer')
    expect(callStatusCode('ended', 'weird')).toBe('end.error')
    expect(callStatusCode('ended')).toBe('end.error')
  })

  it('knows when a call is active and how long it ran', () => {
    expect(isCallActive('dialing')).toBe(true)
    expect(isCallActive('idle')).toBe(false)
    expect(isCallActive('ended')).toBe(false)
    expect(formatCallDuration(65)).toBe('1:05')
    expect(formatCallDuration(null)).toBe('0:00')
    const now = Date.parse('2026-11-11T01:01:05Z')
    expect(secondsSince('2026-11-11T01:00:00Z', now)).toBe(65)
    expect(secondsSince('bad', now)).toBe(0)
  })
})

describe('branch phone calls', () => {
  it('forgets dials the phone never reported', () => {
    const now = 1_000_000
    const dialing: Record<string, number> = { old: now - DIAL_WAIT_MS, fresh: now - 1000 }
    pruneDialing(dialing, now)
    expect(dialing).toEqual({ fresh: now - 1000 })
  })

  it('finds the call of a conversation and refuses answering off the cable', () => {
    const list = [{ call_id: 'c1', conversation_uuid: 'u1' }]
    expect(branchCallFor(list, 'u1')?.call_id).toBe('c1')
    expect(branchCallFor(list, 'u2')).toBe(null)
    expect(branchCallFor(list, '')).toBe(null)
    expect(needsCable({ computer_audio: false })).toBe(true)
    expect(needsCable({})).toBe(false)
  })

  it('upsamples 16 kHz PCM', () => {
    const out = upsample(new Int16Array([0, 16384, 32767]), 48000)
    expect(out.length).toBe(9)
    expect(out[3]).toBeCloseTo(0.5, 3)
  })
})

describe('Fanpage Web calls', () => {
  const ringing = { channel: 'fb-bridge-web', account: 'p', call_id: 'r', ring_id: 'g1', state: 'ringing', since: 's1' }

  it('keys calls and sends ring_id when known', () => {
    expect(fbwebKey(ringing)).toBe('p:r')
    expect(isFbwebCall(ringing)).toBe(true)
    expect(isFbwebCall({ channel: 'sms' })).toBe(false)
    expect(withRing({ offer: 'x' }, 'g1')).toEqual({ offer: 'x', ring_id: 'g1' })
    expect(withRing({ offer: 'x' }, '')).toEqual({ offer: 'x' })
  })

  it('silences one invitation, not the room', () => {
    expect(fbwebSilenceKey(ringing)).toBe('p:r:s1')
    const live = liveSilenceKeys([ringing, { ...ringing, state: 'active' }, { ...ringing, channel: 'sms' }])
    expect([...live]).toEqual(['p:r:s1'])
  })

  it('ends a call the customer hung up or called again', () => {
    expect(fbwebCallGone([ringing], 'p:r', 'g1')).toBe(false)
    expect(fbwebCallGone([], 'p:r', 'g1')).toBe(true)
    expect(fbwebCallGone([{ ...ringing, ring_id: 'g2' }], 'p:r', 'g1')).toBe(true)
    // Gateway cũ không có ring_id: chỉ dựa vào khoá.
    expect(fbwebCallGone([{ ...ringing, ring_id: '' }], 'p:r', 'g1')).toBe(false)
  })

  it('counts decoded frames to see the customer camera', () => {
    const report = new Map([
      ['a', { type: 'inbound-rtp', kind: 'video', trackIdentifier: 't1', framesDecoded: 30 }],
      ['b', { type: 'inbound-rtp', kind: 'audio', framesDecoded: 99 }]
    ])
    expect(decodedFrames(report, 't1')).toBe(30)
    expect(decodedFrames(report, 't2')).toBe(0)
    const on = cameraState({ frames: 0, at: 0, on: false }, 30, 1000)
    expect(on).toEqual({ frames: 30, at: 1000, on: true })
    expect(cameraState(on, 30, 2500).on).toBe(true)
    expect(cameraState(on, 30, 3000).on).toBe(false)
  })
})
