// Message updates that arrive before their message is in the list.
//
// When an agent sends, the reply is POSTed and the server may mark it sent (and push a
// message_update over the websocket) before the POST response comes back: over a slow link
// (a tunnel) the push wins. The update was dropped, then the POST response put the message in
// the list with its first status, so it showed "sending" until a reload. Updates for a message
// the list doesn't have yet are kept for a short while and applied when it arrives.

export const EARLY_UPDATE_TTL_MS = 30000

export function createEarlyUpdates ({ ttl = EARLY_UPDATE_TTL_MS, now = () => Date.now() } = {}) {
  const pending = new Map() // uuid -> { fields, at }

  function prune () {
    const cutoff = now() - ttl
    for (const [uuid, entry] of pending) {
      if (entry.at < cutoff) pending.delete(uuid)
    }
  }

  return {
    // keep merges an update for a message not in the list yet (later fields win).
    keep (uuid, fields) {
      if (!uuid || !fields) return
      prune()
      const prev = pending.get(uuid)
      pending.set(uuid, { fields: { ...(prev?.fields || {}), ...fields }, at: now() })
    },
    // take returns (and forgets) what arrived early for uuid, or null.
    take (uuid) {
      prune()
      const entry = pending.get(uuid)
      if (!entry) return null
      pending.delete(uuid)
      return entry.fields
    },
    get size () {
      return pending.size
    }
  }
}
