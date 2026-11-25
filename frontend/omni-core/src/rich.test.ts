import { describe, expect, it } from 'vitest'
import {
  OMNI_EVENT_SINCE,
  contentLines,
  eventNote,
  isAttachmentLabelOnly,
  previewParts,
  richCard,
  videoDuration
} from './index'

const incoming = (content: string, extra = {}) => ({ type: 'incoming', private: false, content, attachments: [], ...extra })
const note = (content: string, extra = {}) => ({
  type: 'outgoing',
  private: true,
  content,
  attachments: [],
  created_at: '2026-11-20T00:00:00Z',
  ...extra
})

describe('contentLines', () => {
  it('splits HTML on <br> and paragraphs and keeps plain "<…>"', () => {
    expect(contentLines('<p>a<br>b</p><p>c &amp; d</p>')).toEqual(['a', 'b', 'c & d'])
    expect(contentLines('giá <100k\n\n và >50k')).toEqual(['giá <100k', 'và >50k'])
    expect(contentLines(null)).toEqual([])
  })
})

describe('previewParts', () => {
  it('names the kind of the last message and drops the emoji', () => {
    expect(previewParts('🖼️ Ảnh')).toEqual({ kind: 'image', text: 'Ảnh' })
    expect(previewParts('📎 bao-gia.pdf')).toEqual({ kind: 'file', text: 'bao-gia.pdf' })
    expect(previewParts('🎤 Ghi âm')).toEqual({ kind: 'audio', text: 'Ghi âm' })
    expect(previewParts('↪ «Trúc: form» gửi e ảnh')).toEqual({ kind: 'quote', text: 'gửi e ảnh' })
    expect(previewParts('👤 Chủ tài khoản trả lời trực tiếp (điện thoại/ứng dụng khác). · Chủ tài khoản ok')).toEqual({
      kind: 'owner',
      text: 'ok'
    })
    expect(previewParts('👤 Danh thiếp: Ngọc')).toEqual({ kind: 'contact', text: 'Danh thiếp: Ngọc' })
    expect(previewParts('xin chào')).toEqual({ kind: null, text: 'xin chào' })
    expect(previewParts(null)).toEqual({ kind: null, text: '' })
  })
})

describe('richCard', () => {
  it('reads links, contacts and locations', () => {
    expect(richCard(incoming('<p>🔗 Bảng giá dịch vụ VetGo<br>https://vetgo.vn/bang-gia<br>Tiêm phòng</p>'))).toEqual({
      kind: 'link',
      title: 'Bảng giá dịch vụ VetGo',
      lines: ['Tiêm phòng'],
      url: 'https://vetgo.vn/bang-gia',
      pollCreator: '',
      missed: false
    })
    expect(richCard(incoming('<p>👤 Danh thiếp: Trần Bảo Ngọc<br>https://zalo.me/qr/p/x</p>'))?.title).toBe('Trần Bảo Ngọc')
    const loc = richCard(incoming('<p>📍 Vị trí<br>12 Nguyễn Huệ<br>https://www.google.com/maps?q=1,2</p>'))
    expect([loc?.kind, loc?.title, loc?.lines, loc?.url]).toEqual(['location', '12 Nguyễn Huệ', [], 'https://www.google.com/maps?q=1,2'])
  })

  it('reads polls, friend requests, missed calls, big videos and undecryptable messages', () => {
    const poll = richCard(incoming('<p>📊 Lan: Đi khám ngày nào?<br>• Thứ 7<br>- Chủ nhật</p>'))
    expect([poll?.pollCreator, poll?.title, poll?.lines]).toEqual(['Lan', 'Đi khám ngày nào?', ['Thứ 7', 'Chủ nhật']])
    expect(richCard(incoming('<p>🤝 Lời mời kết bạn «Chào shop»</p>'))?.title).toBe('Chào shop')
    expect(richCard(incoming('<p>📞 Đã nhỡ cuộc gọi thoại lúc 10:12</p>'))?.missed).toBe(true)
    const video = richCard(incoming('🎬 ten.mp4 · 0:48 · 11.2 MB — xem & ghi chú review: https://x.y/v · Ghi chú'))
    expect([video?.kind, video?.title, video?.url, video?.lines]).toEqual(['video', 'ten.mp4', 'https://x.y/v', ['0:48 · 11.2 MB · Ghi chú']])
    expect(richCard(incoming('<p>⚠️ Tin nhắn mã hóa không giải mã được: xem trên Messenger</p>'))?.kind).toBe('undecryptable')
  })

  it('skips video labels with a file, notes, activities and plain text', () => {
    expect(richCard(incoming('<p>🎬 Video · 0:05</p>', { attachments: [{ name: 'v.mp4', content_type: 'video/mp4' }] }))).toBeNull()
    expect(richCard(note('<p>🔗 x</p>'))).toBeNull()
    expect(richCard(incoming('🔗 x', { type: 'activity' }))).toBeNull()
    expect(richCard(incoming('<p>xin chào</p>'))).toBeNull()
  })

  it('reads group messages after the sender prefix', () => {
    const group = { first_name: '👥 Nhóm A' }
    expect(richCard(incoming('<p>[Lan]: 🔗 Trang<br>https://a.b</p>', { author: group }))?.url).toBe('https://a.b')
  })
})

describe('eventNote', () => {
  it('reads gateway notes by emoji before the marker date', () => {
    expect(eventNote(note('<p><strong>↩️ Khách đã thu hồi tin</strong> · Lan</p><p>xin chào</p>'))).toEqual({
      kind: 'recall',
      title: 'Khách đã thu hồi tin',
      sender: 'Lan',
      body: ['xin chào'],
      missed: false
    })
    const call = eventNote(note('<p><strong>📞 Cuộc gọi</strong></p><p>Khách gọi nhỡ · 0:00</p>'))
    expect([call?.kind, call?.title, call?.body, call?.missed]).toEqual(['call', 'Khách gọi nhỡ · 0:00', [], true])
    expect(eventNote(note('<p>ghi chú thường</p>'))).toBeNull()
    expect(eventNote(incoming('<p><strong>↩️ x</strong></p>'))).toBeNull()
  })

  it('follows the omni_event marker', () => {
    const after = new Date(OMNI_EVENT_SINCE + 60_000).toISOString()
    // Ghi chú nhân viên sau mốc, khi gateway đã gắn dấu: không phải sự kiện dù bắt đầu bằng 📞.
    expect(eventNote(note('📞 gọi lại cho khách', { created_at: after }), { markersSeen: true })).toBeNull()
    // Gateway chưa gắn dấu ở phòng khám này: vẫn đoán theo emoji.
    expect(eventNote(note('📞 gọi lại cho khách', { created_at: after }))?.kind).toBe('call')
    expect(eventNote(note('<p>Gửi không được</p>', { created_at: after, meta: { omni_event: 'failed' } }), { markersSeen: true })?.kind).toBe('failed')
    expect(eventNote(note('<p>📞 x</p>', { meta: { omni_event: 'owner_message' } }))).toBeNull()
    expect(eventNote(note('<p>x</p>', { meta: { omni_event: 'toString' } }))).toBeNull()
  })

  it('drops file labels from notes with files', () => {
    const withFile = note('<p><strong>✏️ Khách đã sửa tin</strong></p><p>🖼️ Ảnh</p><p>mới</p>', {
      attachments: [{ name: 'a.png', content_type: 'image/png' }]
    })
    expect(eventNote(withFile)?.body).toEqual(['mới'])
  })
})

describe('file labels', () => {
  const files = [{ name: 'a.png', content_type: 'image/png' }]
  it('hides text that only repeats the attached files', () => {
    expect(isAttachmentLabelOnly('<p>🖼️ Ảnh, 📎 bao-gia.pdf</p>', files)).toBe(true)
    expect(isAttachmentLabelOnly('<p>[Lan]: 🖼️ Ảnh</p>', files)).toBe(true)
    expect(isAttachmentLabelOnly('<p>🖼️ Ảnh đẹp quá</p>', files)).toBe(false)
    expect(isAttachmentLabelOnly('<p>🖼️ Ảnh</p>', [])).toBe(false)
    expect(videoDuration('<p>🎬 Video · 0:05</p>')).toBe('0:05')
    expect(videoDuration('x')).toBe('')
  })
})
