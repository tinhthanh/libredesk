import { afterEach, describe, expect, it, vi } from 'vitest'
import { branchAudio, needsCable, readyForCall, releaseUnusedMic, stopBranchAudio, upsample } from './branchCallAudio.js'

describe('branch call audio', () => {
  it('refuses answering only when the phone is known to be off the cable', () => {
    expect(needsCable({ computer_audio: false })).toBe(true)
    expect(needsCable({ computer_audio: true })).toBe(false)
    expect(needsCable({})).toBe(false)
    expect(needsCable(null)).toBe(false)
  })

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

  describe('microphone before the phone answers', () => {
    const stop = vi.fn()
    const stream = { getTracks: () => [{ stop }] }
    class FakeAudioContext {
      state = 'running'
      resume () { return Promise.resolve() }
    }
    const setup = (getUserMedia, isSecureContext = true) => {
      vi.stubGlobal('window', { isSecureContext, AudioContext: FakeAudioContext })
      vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    }
    afterEach(() => {
      stopBranchAudio()
      stop.mockClear()
      vi.unstubAllGlobals()
    })

    it('refuses when the microphone is denied, so the phone is not answered', async () => {
      setup(vi.fn().mockRejectedValue(new Error('NotAllowedError')))
      expect(await readyForCall()).toBe('mic')
    })

    it('asks once and keeps the microphone for the call', async () => {
      const getUserMedia = vi.fn().mockResolvedValue(stream)
      setup(getUserMedia)
      expect(await readyForCall()).toBe('')
      expect(await readyForCall()).toBe('')
      expect(getUserMedia).toHaveBeenCalledTimes(1)
    })

    it('lets go of the microphone when the call did not happen', async () => {
      setup(vi.fn().mockResolvedValue(stream))
      await readyForCall()
      releaseUnusedMic()
      expect(stop).toHaveBeenCalledTimes(1)
    })

    it('needs a secure page', async () => {
      setup(vi.fn(), false)
      expect(await readyForCall()).toBe('insecure')
    })
  })
})
