import { describe, expect, it } from 'vitest'
import { groupSender, isOmnichannelInbox, senderAvatarURL, stripGroupSender } from './omnichannel.js'

const group = { first_name: '👥 Nhóm A', last_name: '· Zalo acc2' }

describe('omnichannel group senders', () => {
  it('reads the member name only for incoming group messages', () => {
    expect(groupSender({ type: 'incoming', author: group, content: '[Nguyễn Văn A]: chào' })).toBe('Nguyễn Văn A')
    expect(groupSender({ type: 'incoming', author: { first_name: 'An' }, content: '[B]: x' })).toBe('')
    expect(groupSender({ type: 'outgoing', author: group, content: '[B]: x' })).toBe('')
    expect(groupSender({ type: 'incoming', author: group, content: '🖼️ Ảnh' })).toBe('')
  })

  it('strips the prefix and builds the avatar URL', () => {
    expect(stripGroupSender('[An]: ↪ «B: hi»\nok')).toBe('↪ «B: hi»\nok')
    expect(senderAvatarURL('c-1', 'Nguyễn A')).toBe('/gw/avatar?conv=c-1&name=Nguy%E1%BB%85n%20A')
    expect(senderAvatarURL('', 'A')).toBe('')
  })

  it('recognises gateway inboxes', () => {
    expect(isOmnichannelInbox({ inbox_name: 'Zalo - acc2' })).toBe(true)
    expect(isOmnichannelInbox({ inbox_name: 'Facebook - default' })).toBe(true)
    expect(isOmnichannelInbox({ inbox_name: 'Support' })).toBe(false)
  })
})
