import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/api', () => ({ default: {} }))

const { callStatusKey, formatCallDuration, waitIceGathering, zaloAccountOf } = await import('./omnichannelCall.js')

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
})
