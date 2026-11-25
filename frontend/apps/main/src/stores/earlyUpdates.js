// Message updates that arrive before their message is in the list: kept for a
// short while and applied when the message arrives. Shared with the Vetgo app
// through omni-core (see omni-core/src/early-updates.ts for why).
export { EARLY_UPDATE_TTL_MS, createEarlyUpdates } from '@omni-core'
