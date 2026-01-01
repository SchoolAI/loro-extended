/**
 * Handle doc-imported - Propagate imported document changes to other peers
 *
 * This is triggered after we import data from a peer via sync-response.
 * It handles two critical tasks:
 *
 * 1. **Update peer awareness** - Set the source peer's awareness to our CURRENT
 *    version (after import). This prevents echo loops because our version now
 *    includes both local and imported changes.
 *
 * 2. **Multi-hop propagation** - Forward the changes to OTHER peers who are
 *    subscribed to this document. This enables hub-and-spoke topologies where
 *    a server relays changes between clients.
 *
 * ## Why This Exists
 *
 * Previously, doc.subscribe() fired synchronously during import, before peer
 * awareness could be updated. This caused echo loops:
 *
 * 1. Peer A sends us data (version {A: 5})
 * 2. We set peer awareness to {A: 5}
 * 3. We import, our version becomes {A: 5, B: 3} (if we had local changes)
 * 4. doc.subscribe() fires, triggers doc-change
 * 5. doc-change sees our version {A: 5, B: 3} > peer awareness {A: 5}
 * 6. We send our local changes back to peer A (ECHO!)
 *
 * Now, doc.subscribe() only fires for "local" events. Import events are
 * handled here, where we can update peer awareness BEFORE propagating.
 *
 * @see handle-sync-response.ts - Where imports are initiated
 * @see handle-local-doc-change.ts - Similar logic for local changes
 * @see propagate-to-peers.ts - Shared propagation logic
 */

import type { Logger } from "@logtape/logtape"
import type { Permissions } from "../../permissions.js"
import type { Command, SynchronizerModel } from "../../synchronizer-program.js"
import type { DocId, PeerID } from "../../types.js"
import { setPeerDocumentAwareness } from "../peer-state-helpers.js"
import { batchAsNeeded } from "../utils.js"
import { propagateToPeers } from "./propagate-to-peers.js"

export function handleDocImported(
  msg: {
    type: "synchronizer/doc-imported"
    docId: DocId
    fromPeerId: PeerID
  },
  model: SynchronizerModel,
  permissions: Permissions,
  logger: Logger,
): Command | undefined {
  const { docId, fromPeerId } = msg

  const docState = model.documents.get(docId)

  if (!docState) {
    logger.warn("doc-imported: unable to find doc-state {docId}", { docId })
    return
  }

  // Get our current version AFTER import
  const ourVersion = docState.doc.version()

  // STEP 1: Update the source peer's awareness to our CURRENT version
  // This prevents echo loops - they sent us data, and now we know they have
  // everything we have (since we just imported their data)
  const sourcePeerState = model.peers.get(fromPeerId)
  if (sourcePeerState) {
    setPeerDocumentAwareness(sourcePeerState, docId, "synced", ourVersion)
    logger.trace(
      "doc-imported: updated peer awareness for {peerId} to our version",
      {
        docId,
        peerId: fromPeerId,
        ourVersion: ourVersion.toJSON(),
      },
    )
  }

  logger.trace(
    "doc-imported processing for {docId} from {fromPeerId} with {channelCount} channels",
    {
      docId,
      fromPeerId,
      channelCount: model.channels.size,
    },
  )

  // STEP 2: Propagate to OTHER peers (multi-hop)
  // Skip the source peer - they already have this data!
  const commands = propagateToPeers({
    docId,
    docState,
    ourVersion,
    model,
    permissions,
    logger,
    logPrefix: "doc-imported",
    excludePeerId: fromPeerId,
  })

  return batchAsNeeded(...commands)
}
