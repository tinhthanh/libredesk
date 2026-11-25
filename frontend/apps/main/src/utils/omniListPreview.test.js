import { describe, expect, it } from 'vitest'
import { lastMessageByStaff, omniListPreview } from './omnichannel.js'
import { OMNI_PREVIEW_ICONS } from '../features/conversation/list/omniPreviewIcons.js'

const conv = (last_message, extra = {}) => ({ inbox_name: 'Zalo - acc2', last_message, ...extra })

describe('conversation list preview for gateway inboxes', () => {
  it('splits the group member, the kind and the text', () => {
    expect(omniListPreview(conv('[Nguyen Van B]: 📊 Nguyen Van B cập nhật bình chọn: lich kham?'))).toEqual({
      sender: 'Nguyen Van B',
      kind: 'poll',
      text: 'Nguyen Van B cập nhật bình chọn: lich kham?'
    })
    expect(omniListPreview(conv('🖼️ Ảnh'))).toEqual({ sender: '', kind: 'image', text: 'Ảnh' })
    expect(omniListPreview(conv('📞 Cuộc gọi thoại nhỡ'))).toEqual({ sender: '', kind: 'call', text: 'Cuộc gọi thoại nhỡ' })
    expect(omniListPreview(conv('↪ «Trúc: form» gửi e ảnh'))).toEqual({ sender: '', kind: 'quote', text: 'gửi e ảnh' })
    expect(omniListPreview(conv('xin chào'))).toEqual({ sender: '', kind: null, text: 'xin chào' })
    expect(omniListPreview(conv(null))).toEqual({ sender: '', kind: null, text: '' })
  })

  it('leaves other inboxes to the default preview', () => {
    expect(omniListPreview({ inbox_name: 'Support', last_message: '🖼️ Ảnh' })).toBeNull()
    expect(omniListPreview(null)).toBeNull()
  })

  it('marks only real staff replies, not gateway notes', () => {
    expect(lastMessageByStaff(conv('ok', { last_message_sender: 'agent', last_message_omni_event: null }))).toBe(true)
    expect(lastMessageByStaff(conv('📞 x', { last_message_sender: 'agent', last_message_omni_event: 'call' }))).toBe(false)
    // Server without the field: guess by the note's emoji.
    expect(lastMessageByStaff(conv('📞 Thanh gọi khách', { last_message_sender: 'agent' }))).toBe(false)
    expect(lastMessageByStaff(conv('dạ vâng', { last_message_sender: 'agent' }))).toBe(true)
    expect(lastMessageByStaff(conv('dạ vâng', { last_message_sender: 'contact' }))).toBe(false)
  })

  it('has an icon for every kind', () => {
    const kinds = ['owner', 'quote', 'sticker', 'image', 'file', 'video', 'audio', 'call', 'link', 'contact', 'poll', 'location', 'todo', 'friend', 'alert']
    for (const k of kinds) expect(OMNI_PREVIEW_ICONS[k], k).toBeTruthy()
  })
})
