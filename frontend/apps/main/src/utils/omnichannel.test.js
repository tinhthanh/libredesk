import { describe, expect, it } from 'vitest'
import {
  groupSender,
  canRecallInbox,
  customerQuote,
  isOmnichannelInbox,
  isSticker,
  isStickerOnly,
  nextReaction,
  omniChannel,
  ownerPreview,
  ownerReply,
  REACTION_CHOICES,
  quoteHTML,
  quotePreview,
  quoteTarget,
  quoteText,
  replyQuote,
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
    expect(isOmnichannelInbox({ inbox_name: 'SMS - q7' })).toBe(true)
    expect(omniChannel({ inbox_name: 'SMS - q7' })).toBe('sms')
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

  it('splits an agent reply from its quote', () => {
    const html = quoteHTML({ uuid: 'm1', author: 'Thùy Ngân', text: 'Có rảnh k & khi nào' }) + '<p>đúng rồi</p>'
    expect(replyQuote(html)).toEqual({ author: 'Thùy Ngân', text: 'Có rảnh k & khi nào', body: '<p>đúng rồi</p>' })
    expect(replyQuote('<blockquote data-reply-uuid="m1"><p>chỉ có chữ</p></blockquote>x')).toEqual({
      author: '',
      text: 'chỉ có chữ',
      body: 'x'
    })
    expect(replyQuote('<p>không trích</p><blockquote data-reply-uuid="m1"><p>A: b</p></blockquote>')).toBeNull()
    expect(replyQuote('<blockquote><p>A: thư email</p></blockquote>')).toBeNull()
    expect(replyQuote(null)).toBeNull()
  })

  it('splits a customer reply from its quote', () => {
    expect(customerQuote('↪ «Diep Ngoc Truc: Chị gửi file»\n@Diep chị gửi e ảnh\nnha')).toEqual({
      author: 'Diep Ngoc Truc',
      text: 'Chị gửi file',
      body: '@Diep chị gửi e ảnh\nnha'
    })
    expect(customerQuote('↪ «(tin được trả lời không còn trong bộ nhớ của bot)»\nok').author).toBe('')
    expect(customerQuote('không trích ↪ «A: b»\nx')).toBeNull()
    expect(quoteText('[Nhất]: ↪ «Trúc: form giấy»\nchị gửi e ảnh')).toBe('chị gửi e ảnh')
    expect(quotePreview('[Nhất]: ↪ «Trúc: form giấy» chị gửi e ảnh')).toBe('[Nhất]: ↩ chị gửi e ảnh')
    expect(quotePreview('xin chào')).toBe('xin chào')
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

  it('treats Fanpage Web inboxes as omnichannel without recall', () => {
    expect(isOmnichannelInbox({ inbox_name: 'Fanpage Web - vetgo' })).toBe(true)
    expect(canRecallInbox({ inbox_name: 'Fanpage Web - vetgo' })).toBe(false)
  })

  it('treats Zalo OA inboxes as omnichannel without recall', () => {
    expect(isOmnichannelInbox({ inbox_name: 'Zalo OA - shop' })).toBe(true)
    expect(canRecallInbox({ inbox_name: 'Zalo OA - shop' })).toBe(false)
  })
})

describe('omnichannel channel of an inbox', () => {
  it('tells the five gateway channels apart', () => {
    expect(omniChannel({ inbox_name: 'Zalo - acc2' })).toBe('zalo')
    expect(omniChannel({ inbox_name: 'Zalo OA - shop' })).toBe('zalo-oa')
    expect(omniChannel({ inbox_name: 'Facebook - default' })).toBe('facebook')
    expect(omniChannel({ inbox_name: 'Fanpage - tuankhai' })).toBe('fanpage')
    expect(omniChannel({ inbox_name: 'Fanpage Web - vetgo' })).toBe('fanpage-web')
  })

  it('returns nothing for other inboxes', () => {
    expect(omniChannel({ inbox_name: 'Support' })).toBe('')
    expect(omniChannel({ inbox_name: 'Zalo' })).toBe('')
    expect(omniChannel(null)).toBe('')
  })
})

describe('omnichannel stickers', () => {
  const sticker = { name: 'sticker.webp', content_type: 'image/webp' }

  it('recognises the names every bot gives a sticker', () => {
    expect(isSticker(sticker)).toBe(true)
    expect(isSticker({ name: 'sticker-2.png', content_type: 'image/png' })).toBe(true)
    expect(isSticker({ name: 'sticker-21458.webp', content_type: 'image/webp' })).toBe(true)
    expect(isSticker({ name: 'anh.png', content_type: 'image/png' })).toBe(false)
    expect(isSticker({ name: 'stickers-list.pdf', content_type: 'application/pdf' })).toBe(false)
    expect(isSticker({ name: 'sticker.mp4', content_type: 'video/mp4' })).toBe(false)
  })

  it('draws a sticker bare only when it is alone and has no text', () => {
    expect(isStickerOnly('', [sticker])).toBe(true)
    expect(isStickerOnly('<p></p>', [sticker])).toBe(true)
    expect(isStickerOnly('[Nguyễn A]: ', [sticker])).toBe(true)
    expect(isStickerOnly('Xin chào', [sticker])).toBe(false)
    expect(isStickerOnly('', [sticker, { name: 'anh.png', content_type: 'image/png' }])).toBe(false)
    expect(isStickerOnly('', [{ name: 'anh.png', content_type: 'image/png' }])).toBe(false)
    expect(isStickerOnly('', [])).toBe(false)
  })
})

describe('omnichannel owner replies', () => {
  const head = '<p><strong>👤 Chủ tài khoản trả lời trực tiếp (điện thoại/ứng dụng khác)</strong> · Chủ tài khoản</p>'

  it('splits the gateway heading from the reply', () => {
    expect(ownerReply(head + '<p>Xin chào</p>', false)).toEqual({ sender: 'Chủ tài khoản', body: '<p>Xin chào</p>' })
    expect(ownerReply('<p><strong>👤 Chủ tài khoản trả lời trực tiếp (x)</strong> · An &amp; Bình</p><p>ok</p>', false).sender).toBe('An & Bình')
    expect(ownerReply('<p>Xin chào</p>', false)).toBe(null)
    expect(ownerReply('<p><strong>✏️ Tin nhắn đã được sửa</strong></p>', false)).toBe(null)
  })

  it('drops a media label only when the file is attached', () => {
    expect(ownerReply(head + '<p>🖼️ Ảnh</p>', true).body).toBe('')
    expect(ownerReply(head + '<p>🎬 Video · 0:11</p>', true).body).toBe('')
    expect(ownerReply(head + '<p>📎 bao-gia.pdf</p>', true).body).toBe('')
    expect(ownerReply(head + '<p>🖼️ Ảnh</p>', false).body).toBe('<p>🖼️ Ảnh</p>')
    expect(ownerReply(head + '<p>Gửi anh ảnh</p>', true).body).toBe('<p>Gửi anh ảnh</p>')
  })

  it('shortens the list preview', () => {
    expect(ownerPreview('👤 Chủ tài khoản trả lời trực tiếp (điện thoại/ứng dụng khác). · Chủ tài khoản Xin chao')).toBe('Xin chao')
    expect(ownerPreview('Xin chao')).toBe(null)
  })
})
