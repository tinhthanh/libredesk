// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { later, resetBackgroundTimer } from './backgroundTimer.js'

// Worker giả: chạy hẹn bằng setTimeout của test (fake timers), ghi lại tin nhận được.
class FakeWorker {
  constructor (url) {
    FakeWorker.created.push(this)
    this.url = url
    this.messages = []
    this.timers = new Map()
  }

  postMessage (msg) {
    this.messages.push(msg)
    clearTimeout(this.timers.get(msg.id))
    if (!msg.cancel) this.timers.set(msg.id, setTimeout(() => this.onmessage({ data: msg.id }), msg.ms))
  }
}
FakeWorker.created = []

function setHidden (hidden) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setHidden(false)
  resetBackgroundTimer()
  FakeWorker.created = []
})

describe('later', () => {
  it('uses setTimeout while the tab is visible', () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    const fn = vi.fn()
    later(fn, 3000)
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledOnce()
    expect(FakeWorker.created).toHaveLength(0)
  })

  it('schedules in one worker while the tab is hidden, and can cancel', () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    setHidden(true)
    const fn = vi.fn()
    later(fn, 3000)
    const cancel = later(() => { throw new Error('cancelled timer ran') }, 3000)
    cancel()
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledOnce()
    expect(FakeWorker.created).toHaveLength(1)
    expect(FakeWorker.created[0].messages.at(-1)).toEqual({ id: 2, cancel: true })
  })

  it('falls back to setTimeout when no worker can be created or it fails', () => {
    vi.useFakeTimers()
    setHidden(true)
    vi.stubGlobal('Worker', class { constructor () { throw new Error('blocked') } })
    const fn = vi.fn()
    later(fn, 1000)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledOnce()

    resetBackgroundTimer()
    vi.stubGlobal('Worker', class extends FakeWorker { postMessage () {} })
    const lost = vi.fn()
    later(lost, 1000)
    FakeWorker.created.at(-1).onerror()
    vi.advanceTimersByTime(0)
    expect(lost).toHaveBeenCalledOnce()
  })
})
