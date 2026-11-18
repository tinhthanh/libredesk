import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/api', () => ({
  default: {
    getChannelCallAccounts: vi.fn(async () => ({
      data: { zalo_accounts: [], video_accounts: [], sms_accounts: ['t.q7', 't.q1'], sms_needs_cable: ['t.q7'] }
    }))
  }
}))

import { accountListed, callFeature, ensureCallFeature } from './omnichannelCall.js'

describe('call feature', () => {
  it('knows which SMS branches need the cable before a call', async () => {
    await ensureCallFeature()
    expect(callFeature.smsNeedsCable).toEqual(['t.q7'])
    expect(accountListed(callFeature.smsNeedsCable, 'q7')).toBe(true)
    expect(accountListed(callFeature.smsNeedsCable, 'q1')).toBe(false)
  })
})
