// Kiểu tối thiểu omni-core cần đọc. Kiểu đầy đủ của API (Libredesk, gateway) nằm ở từng giao diện;
// các kiểu ở đây chỉ khai các trường mà hàm dùng, nên đối tượng đầy đủ của hai bên đều truyền vào được.

/** Hội thoại hay mục danh sách: chỉ cần tên inbox. */
export interface InboxRef {
  inbox_name?: string | null
}

export interface PersonName {
  first_name?: string | null
  last_name?: string | null
}

/** Tin của Libredesk (`internal/message/models`). */
export interface MessageLike {
  uuid?: string
  type?: string | null
  content?: string | null
  author?: PersonName | null
  /** Ghi chú nội bộ. */
  private?: boolean | null
  created_at?: string | null
  /** `meta.omni_event`: dấu gateway gắn cho ghi chú của nó. */
  meta?: Record<string, unknown> | null
  attachments?: readonly AttachmentLike[] | null
}

/** Tệp đính kèm của Libredesk. */
export interface AttachmentLike {
  name?: string | null
  content_type?: string | null
  url?: string | null
  thumbnail_url?: string | null
  disposition?: string | null
}

/** Cảm xúc trên một tin (gateway ghi vào `meta`). */
export interface Reaction {
  emoji?: string | null
  mine?: boolean | null
}

/** Mục của danh sách hội thoại Libredesk (`GET /api/v1/conversations/...`). */
export interface ConversationListItemLike {
  last_message?: string | null
  last_message_at?: string | null
  /** 'agent' | 'contact'; Libredesk tính cả ghi chú và hoạt động là của agent. */
  last_message_sender?: string | null
  /** Dấu `meta.omni_event` của tin cuối (libredesk #21); không có trường này ở server cũ. */
  last_message_omni_event?: string | null
}

// --- Tài khoản kênh (gateway GET /gw/accounts) ---

export type AccountState = 'running' | 'starting' | 'retrying' | 'dropped' | 'stopped'

export interface AccountError {
  kind?: string | null
  message?: string | null
}

export interface AccountHistoryItem {
  at?: string | null
  kind?: string | null
  message?: string | null
  count?: number | null
  last_at?: string | null
}

export interface ChannelAccountLike {
  name?: string | null
  state?: string | null
  error?: AccountError | null
  profile?: { displayName?: string | null; connected_at?: string | null } | null
  history?: AccountHistoryItem[] | null
}

export interface ChannelGroupLike {
  channel?: string | null
  accounts?: ChannelAccountLike[] | null
}

/** Lần đăng nhập Fanpage Web (gateway `fbweb_logins`). */
export interface FbwebLoginLike {
  name?: string | null
  state?: string | null
}

/** Một lần chạy canary đã lưu (gateway GET /gw/canary/runs). */
export interface CanaryRunLike {
  report?: {
    problems?: string | null
    canary?: { checks?: Array<{ check: string; ok?: boolean | null; [k: string]: unknown }> | null } | null
  } | null
}

// --- Cuộc gọi (gateway GET /gw/calls/ringing) ---

export interface RingingCallLike {
  channel?: string | null
  account?: string | null
  call_id?: string | null
  ring_id?: string | null
  state?: string | null
  since?: string | null
  conversation_uuid?: string | null
  computer_audio?: boolean | null
}
