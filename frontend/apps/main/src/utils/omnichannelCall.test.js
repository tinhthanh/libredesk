import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/api', () => ({ default: {} }))

const { DIAL_WAIT_MS, branchCallOf, branchCalls, callStatusKey, pruneDialing, formatCallDuration, secondsSince, smsAccountOf, waitIceGathering, zaloAccountOf } =
  await import('./omnichannelCall.js')

describe('omnichannel call helpers', () => {
  it('formats durations as m:ss', () => {
    expect(formatCallDuration(0)).toBe('0:00')
    expect(formatCallDuration(65)).toBe('1:05')
    expect(formatCallDuration(-3)).toBe('0:00')
    expect(formatCallDuration(undefined)).toBe('0:00')
  })

  it('reads the Zalo account from the gateway inbox name', () => {
    expect(zaloAccountOf({ inbox_name: 'Zalo - acc2' })).toBe('acc2')
    expect(zaloAccountOf({ inbox_name: 'Zalo OA - shop' })).toBe('')
    expect(zaloAccountOf({ inbox_name: 'Facebook - acc2' })).toBe('')
    expect(zaloAccountOf(null)).toBe('')
    expect(smsAccountOf({ inbox_name: 'SMS - test' })).toBe('test')
    expect(smsAccountOf({ inbox_name: 'Zalo - acc2' })).toBe('')
    expect(smsAccountOf(null)).toBe('')
  })

  it('finds the branch phone call of a conversation and its running time', () => {
    branchCalls.list = [{ call_id: 'c1', conversation_uuid: 'u1', state: 'active', since: '2026-11-11T01:00:00Z' }]
    expect(branchCallOf('u1')?.call_id).toBe('c1')
    expect(branchCallOf('u2')).toBe(null)
    expect(branchCallOf('')).toBe(null)
    expect(secondsSince('2026-11-11T01:00:00Z', Date.parse('2026-11-11T01:02:05Z'))).toBe(125)
    expect(secondsSince('', 0)).toBe(0)
    branchCalls.list = []
  })

  it('maps states and end reasons to i18n keys', () => {
    expect(callStatusKey('ringing', '')).toBe('conversation.call.state.ringing')
    expect(callStatusKey('ended', 'no_answer')).toBe('conversation.call.end.no_answer')
    expect(callStatusKey('ended', 'something_new')).toBe('conversation.call.end.error')
    expect(callStatusKey('ended', 'server_restart')).toBe('conversation.call.end.server_restart')
  })

  it('waits for ICE gathering or gives up after the timeout', async () => {
    const peer = new EventTarget()
    peer.iceGatheringState = 'gathering'
    const done = waitIceGathering(peer, 1000)
    peer.iceGatheringState = 'complete'
    peer.dispatchEvent(new Event('icegatheringstatechange'))
    await expect(done).resolves.toBeUndefined()

    const slow = new EventTarget()
    slow.iceGatheringState = 'gathering'
    vi.useFakeTimers()
    const timedOut = waitIceGathering(slow, 50)
    vi.advanceTimersByTime(60)
    await expect(timedOut).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('forgets dials that never became a call', () => {
    branchCalls.dialing = { old: 1000, fresh: 1000 + DIAL_WAIT_MS }
    pruneDialing(1000 + DIAL_WAIT_MS + 1)
    expect(Object.keys(branchCalls.dialing)).toEqual(['fresh'])
    branchCalls.dialing = {}
  })
})
