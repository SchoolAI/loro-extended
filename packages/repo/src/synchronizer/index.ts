// Channel message handlers (channel/*)

// Synchronizer message handlers (synchronizer/*)
export { handleChannelAdded } from "./handle-channel-added.js"
export { handleChannelRemoved } from "./handle-channel-removed.js"
export { handleDirectoryRequest } from "./handle-directory-request.js"
export { handleDirectoryResponse } from "./handle-directory-response.js"
export { handleDocChange } from "./handle-doc-change.js"
export { handleDocDelete } from "./handle-doc-delete.js"
export { handleDocEnsure } from "./handle-doc-ensure.js"
export { handleEstablishChannel } from "./handle-establish-channel.js"
export { handleEstablishRequest } from "./handle-establish-request.js"
export { handleEstablishResponse } from "./handle-establish-response.js"
export { handleSyncRequest } from "./handle-sync-request.js"
export { handleSyncResponse } from "./handle-sync-response.js"

// Helper functions
export {
  ensurePeerState,
  getChannelsForPeer,
  getPeersWithDocument,
  setPeerDocumentAwareness,
  shouldSyncWithPeer,
} from "./peer-state-helpers.js"
export { getRuleContext } from "./rule-context.js"
export { getReadyStates } from "./state-helpers.js"
// Types
export type { ChannelHandlerContext } from "./types.js"
export { batchAsNeeded } from "./utils.js"
