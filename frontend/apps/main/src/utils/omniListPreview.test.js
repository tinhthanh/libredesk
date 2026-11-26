import { describe, expect, it } from 'vitest'
import { lastMessageByStaff, omniListPreview } from './omnichannel.js'
import { OMNI_PREVIEW_ICONS } from '../features/conversation/list/omniPreviewIcons.js'

const conv = (last_message, extra = {}) => ({ inbox_name: 'Zalo - acc2', last_message, ...extra })

describe('conversation list preview for gateway inboxes', () => {
  it('splits the group member, the kind and the text', () => {
    expect(omniListPreview(conv('[Nguyen Van B]: 📊 Nguyen Van B cập nhật bình chọn: lich kham?'))).toEqual({
      sender: 'Nguyen Van B',
      kind: 'poll',
      innerKind: null,
      text: 'Nguyen Van B cập nhật bình chọn: lich kham?'
    })
    expect(omniListPreview(conv('🖼️ Ảnh'))).toEqual({ sender: '', kind: 'image', innerKind: null, text: 'Ảnh' })
    expect(omniListPreview(conv('📞 Cuộc gọi thoại nhỡ'))).toEqual({ sender: '', kind: 'call', innerKind: null, text: 'Cuộc gọi thoại nhỡ' })
    expect(omniListPreview(conv('↪ «Trúc: form» gửi e ảnh'))).toEqual({ sender: '', kind: 'quote', innerKind: null, text: 'gửi e ảnh' })
    expect(omniListPreview(conv('xin chào'))).toEqual({ sender: '', kind: null, innerKind: null, text: 'xin chào' })
    expect(omniListPreview(conv(null))).toEqual({ sender: '', kind: null, innerKind: null, text: '' })
  })

  it('reads the owner reply label and gateway event notes', () => {
    expect(omniListPreview(conv('👤 Chủ tài khoản trả lời trực tiếp (điện thoại/ứng dụng khác). 🖼️ Ảnh'))).toEqual({
      sender: '',
      kind: 'owner',
      innerKind: 'image',
      text: 'Ảnh'
    })
    expect(omniListPreview(conv('ℹ️ Thông báo. ⏰ Thu nhac hen'))?.kind).toBe('system')
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
    // Ghi chú của gateway trước khi có dấu omni_event (trường có nhưng null).
    const before = { last_message_sender: 'agent', last_message_omni_event: null, last_message_at: '2026-11-21T10:00:00Z' }
    expect(lastMessageByStaff(conv('📞 Thanh Huynh gọi khách qua Zalo · 1:19', before))).toBe(false)
    // Sau mốc: không dấu là nhân viên tự viết, kể cả khi mở đầu bằng 📞.
    const after = { ...before, last_message_at: '2026-11-24T10:00:00Z' }
    expect(lastMessageByStaff(conv('📞 gọi lại cho khách', after))).toBe(true)
    // Tin hoạt động của Libredesk.
    expect(lastMessageByStaff(conv('System added tag SMS vetgo-test.test-q7', { last_message_sender: 'agent', last_message_omni_event: null }))).toBe(false)
    expect(lastMessageByStaff(conv('System  marked the conversation as Resolved', { last_message_sender: 'agent' }))).toBe(false)
  })

  it('has an icon for every kind', () => {
    const kinds = ['owner', 'quote', 'sticker', 'image', 'file', 'video', 'audio', 'call', 'link', 'contact', 'poll', 'location', 'todo', 'friend', 'alert', 'system', 'recall', 'edit', 'reaction', 'group']
    for (const k of kinds) expect(OMNI_PREVIEW_ICONS[k], k).toBeTruthy()
  })
})

describe('list preview after a Libredesk activity line', () => {
  it('shows the last real message, not "System marked the conversation as Resolved"', () => {
    const c = {
      inbox_name: 'Zalo - acc2',
      last_message: 'System  marked the conversation as Resolved',
      last_message_sender: 'agent',
      last_interaction: '[Lan]: 🖼️ Ảnh',
      last_interaction_sender: 'contact'
    }
    expect(omniListPreview(c)).toEqual({ sender: 'Lan', kind: 'image', innerKind: null, text: 'Ảnh' })
    expect(lastMessageByStaff(c)).toBe(false)
    expect(lastMessageByStaff({ ...c, last_interaction: 'dạ vâng', last_interaction_sender: 'agent' })).toBe(true)
    // Nothing real yet: the activity line stays.
    expect(omniListPreview({ ...c, last_interaction: '' }).text).toContain('marked the conversation')
  })
})
