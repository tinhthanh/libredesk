// Kênh của một hội thoại omnichannel. Libredesk chỉ biết inbox live chat; gateway đặt tên inbox
// "<Kênh> - <tài khoản>" (vd "Zalo - acc2", "Zalo OA - oa1"), nên kênh và tài khoản suy ra từ tên inbox.

import type { InboxRef, Reaction } from './types'

export type OmniChannel = 'zalo' | 'zalo-oa' | 'facebook' | 'fanpage' | 'fanpage-web' | 'sms'

export const OMNI_CHANNELS: readonly OmniChannel[] = [
  'zalo',
  'zalo-oa',
  'facebook',
  'fanpage',
  'fanpage-web',
  'sms'
]

// Tiền tố dài đứng trước tiền tố ngắn: "Zalo OA - " trước "Zalo - ", "Fanpage Web - " trước "Fanpage - ".
export const OMNI_CHANNEL_PREFIXES: ReadonlyArray<readonly [string, OmniChannel]> = [
  ['Zalo OA - ', 'zalo-oa'],
  ['Zalo - ', 'zalo'],
  ['Fanpage Web - ', 'fanpage-web'],
  ['Fanpage - ', 'fanpage'],
  ['Facebook - ', 'facebook'],
  ['SMS - ', 'sms']
]

const inboxName = (conversation: InboxRef | null | undefined): string =>
  conversation?.inbox_name || ''

const prefixOf = (name: string) => OMNI_CHANNEL_PREFIXES.find(([prefix]) => name.startsWith(prefix))

// isOmnichannelInbox: inbox do gateway tạo.
export function isOmnichannelInbox(conversation: InboxRef | null | undefined): boolean {
  return !!prefixOf(inboxName(conversation))
}

// omniChannel: kênh của inbox gateway, '' với inbox khác.
export function omniChannel(conversation: InboxRef | null | undefined): OmniChannel | '' {
  return prefixOf(inboxName(conversation))?.[1] ?? ''
}

// inboxAccount: tên tài khoản sau "<Kênh> - " ('' với inbox khác). Có `channel` thì chỉ nhận kênh đó.
export function inboxAccount(conversation: InboxRef | null | undefined, channel?: OmniChannel): string {
  const name = inboxName(conversation)
  const hit = prefixOf(name)
  if (!hit || (channel && hit[1] !== channel)) return ''
  return name.slice(hit[0].length)
}

// accountListed: tài khoản của inbox có trong danh sách gateway trả. Phòng khám omi đặt tên tài khoản
// "<slug>.<tên>" trong danh sách còn inbox chỉ có "<tên>": khớp cả hai dạng (gateway của một phòng
// khám chỉ có tài khoản của phòng khám đó).
export function accountListed(list: unknown, name: string | null | undefined): boolean {
  if (!name || !Array.isArray(list)) return false
  return list.some((a) => a === name || (typeof a === 'string' && a.endsWith('.' + name)))
}

// senderAvatarURL: avatar thành viên nhóm, gateway phục vụ ở /gw/avatar.
export function senderAvatarURL(conversationUUID: string | null | undefined, name: string | null | undefined): string {
  if (!conversationUUID || !name) return ''
  return `/gw/avatar?conv=${encodeURIComponent(conversationUUID)}&name=${encodeURIComponent(name)}`
}

// canRecallInbox: thu hồi tin nhân viên đã gửi, chỉ Zalo và Facebook cá nhân. Messenger không cho Trang
// thu hồi hay sửa, Zalo OA OpenAPI không có thu hồi, tin SMS đã gửi thì không lấy lại được.
export function canRecallInbox(conversation: InboxRef | null | undefined): boolean {
  const channel = omniChannel(conversation)
  return channel === 'zalo' || channel === 'facebook'
}

// Cảm xúc nhân viên gửi được: bộ cả Zalo và Messenger đều hiểu.
export const REACTION_CHOICES = ['❤️', '👍', '😆', '😮', '😢', '😡'] as const

const bareEmoji = (e: unknown) => String(e || '').replace(/\uFE0F/g, '')

// nextReaction: cảm xúc cần gửi khi nhân viên chọn `choice`; chọn lại cảm xúc tài khoản đã thả là bỏ ('').
export function nextReaction(choice: string, reactions: readonly Reaction[] | null | undefined): string {
  const mine = (reactions || []).some((r) => r.mine && bareEmoji(r.emoji) === bareEmoji(choice))
  return mine ? '' : choice
}
