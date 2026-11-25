// Cập nhật tin tới trước khi tin có trong danh sách.
//
// Nhân viên gửi tin: câu trả lời được POST, và server có thể đánh dấu đã gửi (đẩy message_update qua
// WebSocket) trước khi POST trả về; qua đường chậm (tunnel) bản đẩy tới trước. Bản cập nhật bị bỏ, rồi
// POST trả về đặt tin vào danh sách với trạng thái đầu, nên tin cứ "đang gửi" tới khi tải lại. Cập nhật
// cho tin chưa có trong danh sách được giữ một lúc và áp khi tin tới.

export const EARLY_UPDATE_TTL_MS = 30000

export interface EarlyUpdates<F extends object = Record<string, unknown>> {
  /** Gộp một cập nhật cho tin chưa có trong danh sách (trường sau thắng). */
  keep(uuid: string | null | undefined, fields: F | null | undefined): void
  /** Lấy (và quên) phần đã tới trước của uuid, hay null. */
  take(uuid: string | null | undefined): F | null
  readonly size: number
}

export function createEarlyUpdates<F extends object = Record<string, unknown>>({
  ttl = EARLY_UPDATE_TTL_MS,
  now = () => Date.now()
}: { ttl?: number; now?: () => number } = {}): EarlyUpdates<F> {
  const pending = new Map<string, { fields: F; at: number }>()

  function prune() {
    const cutoff = now() - ttl
    for (const [uuid, entry] of pending) {
      if (entry.at < cutoff) pending.delete(uuid)
    }
  }

  return {
    keep(uuid, fields) {
      if (!uuid || !fields) return
      prune()
      const prev = pending.get(uuid)
      pending.set(uuid, { fields: { ...(prev?.fields || {}), ...fields } as F, at: now() })
    },
    take(uuid) {
      prune()
      if (!uuid) return null
      const entry = pending.get(uuid)
      if (!entry) return null
      pending.delete(uuid)
      return entry.fields
    },
    get size() {
      return pending.size
    }
  }
}
