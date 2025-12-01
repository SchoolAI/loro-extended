// Channel message handlers (channel/*)

// Synchronizer message handlers (synchronizer/*)
export { handleChannelAdded } from "./connection/handle-channel-added.js"
export { handleChannelRemoved } from "./connection/handle-channel-removed.js"
export { handleEstablishChannel } from "./connection/handle-establish-channel.js"
export { handleEstablishRequest } from "./connection/handle-establish-request.js"
export { handleEstablishResponse } from "./connection/handle-establish-response.js"
export { handleDirectoryRequest } from "./discovery/handle-directory-request.js"
export { handleDirectoryResponse } from "./discovery/handle-directory-response.js"
export { handleNewDoc } from "./discovery/handle-new-doc.js"
export { handleEphemeral } from "./ephemeral/handle-ephemeral.js"
// Helper functions
export {
  ensurePeerState,
  getChannelsForPeer,
  getPeersWithDocument,
  setPeerDocumentAwareness,
  shouldSyncWithPeer,
} from "./peer-state-helpers.js"
export { getRuleContext } from "./rule-context.js"
export { handleDocDelete } from "./sync/handle-doc-delete.js"
export { handleDocEnsure } from "./sync/handle-doc-ensure.js"
export { handleLocalDocChange } from "./sync/handle-local-doc-change.js"
export { handleSyncRequest } from "./sync/handle-sync-request.js"
export { handleSyncResponse } from "./sync/handle-sync-response.js"
// Types
export type { ChannelHandlerContext } from "./types.js"
export { batchAsNeeded } from "./utils.js"
