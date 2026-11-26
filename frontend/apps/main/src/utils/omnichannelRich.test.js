import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createI18n } from 'vue-i18n'
import vi from '../../../../../i18n/vi-VN.json'
import { canAcceptFriend, friendRequestAction, hasOmniMarkers, omniEventNote, omniRichCard, richActionKey } from './omnichannel.js'
import OmniEventNote from '../features/conversation/message/OmniEventNote.vue'
import OmniRichCard from '../features/conversation/message/OmniRichCard.vue'
import { TooltipProvider } from '@shared-ui/components/ui/tooltip'

const zalo = { inbox_name: 'Zalo - acc2' }
const email = { inbox_name: 'Support' }
const incoming = (content, extra = {}) => ({ type: 'incoming', private: false, content, attachments: [], ...extra })
const note = (content, extra = {}) => ({
  type: 'outgoing',
  private: true,
  content,
  attachments: [],
  created_at: '2026-11-20T03:04:00Z',
  meta: {},
  ...extra
})

describe('omnichannel event notes and rich cards', () => {
  it('only reads them in gateway inboxes', () => {
    const recall = note('<p><strong>↩️ Khách đã thu hồi tin</strong> · Lan</p><p>xin chào</p>')
    expect(omniEventNote(recall, zalo, false)?.kind).toBe('recall')
    expect(omniEventNote(recall, email, false)).toBeNull()
    const link = incoming('<p>🔗 Bảng giá<br>https://vetgo.vn/bang-gia</p>')
    expect(omniRichCard(link, zalo)?.url).toBe('https://vetgo.vn/bang-gia')
    expect(omniRichCard(link, email)).toBeNull()
    expect(omniRichCard(link, null)).toBeNull()
  })

  it('treats untagged staff notes after the marker date as notes once the gateway tags its own', () => {
    const staff = note('📞 gọi lại cho khách', { created_at: '2026-11-24T00:00:00Z' })
    const tagged = note('<p>📞 Khách gọi nhỡ</p>', { meta: { omni_event: 'call' } })
    expect(hasOmniMarkers([staff])).toBe(false)
    expect(hasOmniMarkers([incoming('x', { meta: { omni_event: 'call' } }), staff])).toBe(false)
    expect(hasOmniMarkers([staff, tagged])).toBe(true)
    expect(hasOmniMarkers(null)).toBe(false)
    expect(omniEventNote(staff, zalo, false)?.kind).toBe('call')
    expect(omniEventNote(staff, zalo, true)).toBeNull()
    expect(omniEventNote(tagged, zalo, true)?.missed).toBe(true)
  })

  it('picks a button label per card kind', () => {
    expect(richActionKey('link')).toBe('conversation.omni.rich.openLink')
    expect(richActionKey('location')).toBe('conversation.omni.rich.openMap')
    expect(richActionKey('call')).toBe('conversation.omni.rich.open')
  })
})

const render = async (component, props) => {
  const app = createSSRApp({ render: () => h(TooltipProvider, null, () => h(component, props)) })
  app.use(createI18n({ legacy: false, locale: 'vi-VN', messages: { 'vi-VN': vi } }))
  return renderToString(app)
}

describe('accepting a Zalo friend request', () => {
  const request = incoming('🤝 Lời mời kết bạn «Xin chào»')
  it('only offers it on a customer request in a Zalo 1-1 conversation', () => {
    const card = omniRichCard(request, zalo)
    expect(card?.kind).toBe('friend')
    expect(canAcceptFriend(card, request, zalo)).toBe(true)
    expect(canAcceptFriend(card, request, { inbox_name: 'Facebook - acc2' })).toBe(false)
    expect(canAcceptFriend(card, { ...request, type: 'outgoing' }, zalo)).toBe(false)
    expect(canAcceptFriend(omniRichCard(incoming('🔗 a<br>https://a.b'), zalo), request, zalo)).toBe(false)
    expect(canAcceptFriend(null, request, zalo)).toBe(false)
  })

  it('keeps the outcome after a reload from the notes that follow the card', () => {
    const card = omniRichCard(request, zalo)
    const accepted = note('<p><strong>🤝 Đã đồng ý lời mời kết bạn</strong> · Lan</p>', {
      created_at: '2026-11-26T03:07:09Z',
      meta: { omni_event: 'friend_event' }
    })
    const removed = note('<p><strong>🤝 Bạn bè</strong></p><p>Đã huỷ kết bạn</p>', {
      created_at: '2026-11-26T03:08:00Z',
      meta: { omni_event: 'friend_event' }
    })
    expect(friendRequestAction(card, request, zalo, [request])).toBe('accept')
    expect(friendRequestAction(card, request, zalo, [request, accepted])).toBe('accepted')
    expect(friendRequestAction(card, request, zalo, [request, accepted, removed])).toBe('')
    expect(friendRequestAction(card, request, { inbox_name: 'Facebook - acc2' }, [request])).toBe('')
    expect(friendRequestAction(card, request, zalo, undefined)).toBe('accept')
  })
})

describe('omnichannel card components', () => {
  it('draws a rich card with its label, lines and a safe link', async () => {
    const card = omniRichCard(incoming('<p>📍 Vị trí<br>12 Nguyễn Huệ<br>https://www.google.com/maps?q=1,2</p>'), zalo)
    const html = await render(OmniRichCard, { card })
    expect(html).toContain('data-omni-rich="location"')
    expect(html).toContain('Vị trí')
    expect(html).toContain('12 Nguyễn Huệ')
    expect(html).toContain('href="https://www.google.com/maps?q=1,2"')
    expect(html).toContain('Mở bản đồ')
  })

  it('draws a poll with its action line as written, options and result lines', async () => {
    const poll = omniRichCard(incoming('<p>📊 Lan tạo bình chọn: Đi khám ngày nào?<br>• Thứ 7<br>• Chủ nhật</p>'), zalo)
    const html = await render(OmniRichCard, { card: poll })
    expect(html).toContain('Lan tạo bình chọn')
    expect(html).not.toContain('tạo bình chọn tạo bình chọn')
    expect(html.match(/<li/g)?.length).toBe(2)
    const vote = omniRichCard(
      incoming('<p>📊 B cập nhật bình chọn: lich kham?<br>Chọn: Chieu<br>Kết quả: Chieu (1) · Sang (0)</p>'),
      zalo
    )
    const voteHtml = await render(OmniRichCard, { card: vote })
    expect(voteHtml).toContain('B cập nhật bình chọn')
    expect(voteHtml).toContain('Kết quả: Chieu (1) · Sang (0)')
    expect(voteHtml).not.toContain('<li')
    const unsafe = await render(OmniRichCard, { card: { ...poll, url: 'javascript:alert(1)' } })
    expect(unsafe).not.toContain('javascript:')
  })

  it('shows the accept button only when asked, disabled once accepted', async () => {
    const card = omniRichCard(incoming('🤝 Lời mời kết bạn «Xin chào»'), zalo)
    expect(await render(OmniRichCard, { card })).not.toContain('data-omni-friend-accept')
    const offer = await render(OmniRichCard, { card, friendAction: 'accept' })
    expect(offer).toContain('data-omni-friend-accept')
    expect(offer).toContain('Đồng ý kết bạn')
    const disabledAttr = /<button[^>]*\sdisabled(="")?[\s>]/
    expect(offer).not.toMatch(disabledAttr)
    const done = await render(OmniRichCard, { card, friendAction: 'accepted' })
    expect(done).toContain('Đã đồng ý kết bạn')
    expect(done).toMatch(disabledAttr)
  })

  it('draws an event note with its title, sender and body', async () => {
    const message = note('<p><strong>↩️ Khách đã thu hồi tin</strong> · Lan</p><p>xin chào</p>')
    const html = await render(OmniEventNote, { message, note: omniEventNote(message, zalo, false) })
    expect(html).toContain('data-omni-event="recall"')
    expect(html).toContain('Khách đã thu hồi tin')
    expect(html).toContain('· Lan')
    expect(html).toContain('xin chào')
  })
})
