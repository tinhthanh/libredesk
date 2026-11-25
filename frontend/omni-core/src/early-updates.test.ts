import { describe, expect, it } from 'vitest'
import { createEarlyUpdates } from './early-updates'

describe('createEarlyUpdates', () => {
  it('gives back an update once, for the message it was for', () => {
    const early = createEarlyUpdates()
    early.keep('m1', { status: 'sent' })
    expect(early.take('m2')).toBeNull()
    expect(early.take('m1')).toEqual({ status: 'sent' })
    expect(early.take('m1')).toBeNull()
  })

  it('merges several updates, the later one winning', () => {
    const early = createEarlyUpdates()
    early.keep('m1', { status: 'sent', meta: { a: 1 } })
    early.keep('m1', { status: 'failed' })
    expect(early.take('m1')).toEqual({ status: 'failed', meta: { a: 1 } })
  })

  it('forgets updates older than the ttl', () => {
    let t = 0
    const early = createEarlyUpdates({ ttl: 1000, now: () => t })
    early.keep('m1', { status: 'sent' })
    t = 1001
    early.keep('m2', { status: 'sent' })
    expect(early.size).toBe(1)
    expect(early.take('m1')).toBeNull()
    expect(early.take('m2')).toEqual({ status: 'sent' })
  })

  it('ignores an update without a message', () => {
    const early = createEarlyUpdates()
    early.keep('', { status: 'sent' })
    early.keep('m1', null)
    expect(early.size).toBe(0)
  })
})
