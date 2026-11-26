import { describe, expect, it } from 'vitest'
import {
  OMNI_EVENT_SINCE,
  contentLines,
  eventNote,
  friendRequestState,
  isActivityText,
  isAttachmentLabelOnly,
  lastMessageByStaff,
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
      text: 'ok',
      innerKind: null
    })
    // Chủ tài khoản gửi ảnh từ điện thoại: nhãn ảnh sau tiêu đề cũng thành loại.
    expect(previewParts('👤 Chủ tài khoản trả lời trực tiếp (điện thoại/ứng dụng khác). 🖼️ Ảnh')).toEqual({
      kind: 'owner',
      text: 'Ảnh',
      innerKind: 'image'
    })
    // Ghi chú sự kiện của gateway.
    expect(previewParts('ℹ️ Thông báo. 🎴 ⏰ Thu nhac hen')).toEqual({ kind: 'system', text: 'Thông báo. 🎴 ⏰ Thu nhac hen' })
    expect(previewParts('↩️ Khách đã thu hồi tin')).toEqual({ kind: 'recall', text: 'Khách đã thu hồi tin' })
    expect(previewParts('✏️ Khách đã sửa tin')).toEqual({ kind: 'edit', text: 'Khách đã sửa tin' })
    expect(previewParts('💬 Lan thả ❤️')).toEqual({ kind: 'reaction', text: 'Lan thả ❤️' })
    expect(previewParts('👥 Lan đã tham gia nhóm')).toEqual({ kind: 'group', text: 'Lan đã tham gia nhóm' })
    // Trích dẫn của khách (↪) không phải thu hồi (↩️).
    expect(previewParts('↪ «A: b» ok').kind).toBe('quote')
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
      pollAction: '',
      options: [],
      missed: false
    })
    expect(richCard(incoming('<p>👤 Danh thiếp: Trần Bảo Ngọc<br>https://zalo.me/qr/p/x</p>'))?.title).toBe('Trần Bảo Ngọc')
    const loc = richCard(incoming('<p>📍 Vị trí<br>12 Nguyễn Huệ<br>https://www.google.com/maps?q=1,2</p>'))
    expect([loc?.kind, loc?.title, loc?.lines, loc?.url]).toEqual(['location', '12 Nguyễn Huệ', [], 'https://www.google.com/maps?q=1,2'])
  })

  it('reads polls, friend requests, missed calls, big videos and undecryptable messages', () => {
    const poll = richCard(incoming('<p>📊 Lan tạo bình chọn: Đi khám ngày nào?<br>• Thứ 7<br>- Chủ nhật</p>'))
    expect([poll?.pollAction, poll?.title, poll?.options, poll?.lines]).toEqual([
      'Lan tạo bình chọn',
      'Đi khám ngày nào?',
      ['Thứ 7', 'Chủ nhật'],
      []
    ])
    // zalo-bot ghi kết quả thành dòng thường, không phải lựa chọn.
    const vote = richCard(
      incoming('<p>📊 Nguyen Van B cập nhật bình chọn: lich kham?<br>Chọn: Chieu chu nhat<br>Kết quả: Chieu chu nhat (1) · Sang thu bay (0)</p>')
    )
    expect([vote?.pollAction, vote?.options, vote?.lines]).toEqual([
      'Nguyen Van B cập nhật bình chọn',
      [],
      ['Chọn: Chieu chu nhat', 'Kết quả: Chieu chu nhat (1) · Sang thu bay (0)']
    ])
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

describe('lastMessageByStaff', () => {
  const agent = { last_message_sender: 'agent' }
  it('tells staff replies from gateway notes and Libredesk activity lines', () => {
    expect(lastMessageByStaff({ ...agent, last_message: 'dạ vâng', last_message_omni_event: null })).toBe(true)
    expect(lastMessageByStaff({ ...agent, last_message: '📞 x', last_message_omni_event: 'call' })).toBe(false)
    expect(lastMessageByStaff({ ...agent, last_message: '📞 x', last_message_omni_event: null, last_message_at: '2026-11-21T00:00:00Z' })).toBe(false)
    expect(lastMessageByStaff({ ...agent, last_message: '📞 x', last_message_omni_event: null, last_message_at: '2026-11-24T00:00:00Z' })).toBe(true)
    expect(lastMessageByStaff({ ...agent, last_message: '👤 Chủ tài khoản trả lời trực tiếp (x). ok' })).toBe(false)
    expect(lastMessageByStaff({ ...agent, last_message: 'Assigned to Lan by System' })).toBe(false)
    expect(lastMessageByStaff({ last_message_sender: 'contact', last_message: 'hi' })).toBe(false)
    expect(lastMessageByStaff(null)).toBe(false)
    expect(isActivityText('System  marked the conversation as Resolved')).toBe(true)
    expect(isActivityText('Đã thêm thẻ')).toBe(false)
  })
})

describe('friendRequestState', () => {
  const marked = (content: string, omni_event: string) =>
    note(content, { created_at: '2026-11-26T03:00:00Z', meta: { omni_event } })
  const request = incoming('🤝 Lời mời kết bạn<br>«Them lai»', { uuid: 'r1' })
  const accepted = marked('<p><strong>🤝 Đã đồng ý lời mời kết bạn</strong> · System</p>', 'friend_event')
  const phone = marked('<p><strong>ℹ️ Thông báo</strong></p><p>Bạn vừa kết bạn với Nguyen Van B</p>', 'system')
  const card = marked('<p><strong>ℹ️ Thông báo</strong></p><p>🤝 Đoàn Duy Nhất đã trở thành bạn bè</p>', 'system')
  const removed = marked('<p><strong>🤝 Bạn bè</strong></p><p>Đã huỷ kết bạn</p>', 'friend_event')
  const ownerAsked = marked('<p><strong>🤝 Bạn bè</strong></p><p>Chủ tài khoản đã gửi lời mời kết bạn: «Them lai»</p>', 'friend_event')
  const undone = marked('<p><strong>🤝 Bạn bè</strong></p><p>Lời mời kết bạn đã bị thu hồi</p>', 'friend_event')

  it('stays open until a later event settles it', () => {
    expect(friendRequestState([removed, request], request)).toBe('open')
    expect(friendRequestState([request, incoming('chào')], request)).toBe('open')
    expect(friendRequestState([request, ownerAsked], request)).toBe('open')
    expect(friendRequestState([], request)).toBe('open')
  })

  it('is accepted after the gateway note, a phone acceptance or the Zalo card', () => {
    expect(friendRequestState([request, accepted], request)).toBe('accepted')
    expect(friendRequestState([request, phone], request)).toBe('accepted')
    expect(friendRequestState([request, card], request)).toBe('accepted')
    // Tìm theo uuid khi giao diện truyền bản sao của tin.
    expect(friendRequestState([request, accepted], { ...request })).toBe('accepted')
  })

  it('is closed when withdrawn, unfriended or replaced by a newer request; the last event wins', () => {
    expect(friendRequestState([request, undone], request)).toBe('closed')
    expect(friendRequestState([request, accepted, removed], request)).toBe('closed')
    const newer = incoming('🤝 Lời mời kết bạn<br>«Lần nữa»', { uuid: 'r2' })
    expect(friendRequestState([request, removed, newer], request)).toBe('closed')
    expect(friendRequestState([request, removed, newer], newer)).toBe('open')
  })

  it('ignores staff notes written after the marker date once markers are seen', () => {
    const staff = note('<p>Đã đồng ý lời mời kết bạn chưa?</p>', { created_at: '2026-11-26T03:00:00Z' })
    expect(friendRequestState([request, staff], request, { markersSeen: true })).toBe('open')
  })
})
