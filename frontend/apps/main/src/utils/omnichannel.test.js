import { describe, expect, it } from 'vitest'
import {
  groupSender,
  canRecallInbox,
  isOmnichannelInbox,
  nextReaction,
  REACTION_CHOICES,
  quoteHTML,
  quoteTarget,
  quoteText,
  senderAvatarURL,
  stripGroupSender
} from './omnichannel.js'

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

describe('omnichannel quote replies', () => {
  it('builds a target with the member name and one line of text', () => {
    const msg = { uuid: 'm-1', type: 'incoming', author: group, content: '[Nguyễn Văn A]: giá   bao\nnhiêu?' }
    expect(quoteTarget('c-1', msg)).toEqual({ conversationUUID: 'c-1', uuid: 'm-1', author: 'Nguyễn Văn A', text: 'giá bao nhiêu?' })
    const one = { uuid: 'm-2', type: 'incoming', author: { first_name: 'Bình', last_name: '· Zalo acc2' }, content: '<p>hi</p>' }
    expect(quoteTarget('c-1', one).author).toBe('Bình')
    expect(quoteText('a'.repeat(200)).length).toBe(120)
  })

  it('escapes the quote HTML', () => {
    expect(quoteHTML({ uuid: 'm"1', author: 'A<b>', text: 'x & y' })).toBe(
      '<blockquote data-reply-uuid="m&quot;1"><p>A&lt;b&gt;: x &amp; y</p></blockquote>'
    )
    expect(quoteHTML(null)).toBe('')
  })

  it('toggles the agent reaction', () => {
    expect(REACTION_CHOICES).toHaveLength(6)
    const reactions = [
      { emoji: '❤', count: 2, names: ['Lan', 'Chủ tài khoản'], mine: true },
      { emoji: '😆', count: 1, names: ['Lan'] }
    ]
    expect(nextReaction('❤️', reactions)).toBe('')
    expect(nextReaction('😆', reactions)).toBe('😆')
    expect(nextReaction('👍', undefined)).toBe('👍')
  })

  it('treats Fanpage inboxes as omnichannel without recall', () => {
    expect(isOmnichannelInbox({ inbox_name: 'Fanpage - tuankhai' })).toBe(true)
    expect(canRecallInbox({ inbox_name: 'Fanpage - tuankhai' })).toBe(false)
    expect(canRecallInbox({ inbox_name: 'Zalo - shop1' })).toBe(true)
    expect(canRecallInbox({ inbox_name: 'Email' })).toBe(false)
  })
})
