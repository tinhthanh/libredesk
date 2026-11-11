import { describe, expect, it } from 'vitest'
import { branchAudio, stopBranchAudio, upsample } from './branchCallAudio.js'

describe('branch call audio', () => {
  it('upsamples 16 kHz PCM to the context rate', () => {
    const pcm = new Int16Array([0, 16384, 32767])
    const out = upsample(pcm, 48000)
    expect(out.length).toBe(9)
    expect(out[0]).toBe(0)
    expect(out[3]).toBeCloseTo(0.5, 3)
    expect(out[1]).toBeGreaterThan(0)
    expect(out[1]).toBeLessThan(out[3])
  })

  it('moves the sound back to the phone without a call open', () => {
    branchAudio.key = 'q1:7'
    branchAudio.status = 'on'
    stopBranchAudio()
    expect(branchAudio.key).toBe('')
    expect(branchAudio.status).toBe('idle')
  })
})
