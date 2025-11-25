/**
 * Handle directory-response - Discover documents from a peer
 *
 * This is the response to our directory-request, or an unsolicited announcement
 * of new documents. The peer is telling us what documents they have (filtered
 * by their `canReveal` rules).
 *
 * ## Pull-Based Discovery Model
 *
 * This handler implements the "pull" side of the pull-based discovery:
 * 1. Peer announces documents (via directory-response)
 * 2. We decide whether we want them
 * 3. We send sync-request for documents we want
 * 4. Peer sends sync-response with the data
 *
 * ## Behavior
 *
 * For each announced document:
 * 1. Create local document state if it doesn't exist
 * 2. Update peer awareness (peer has this document)
 * 3. Add to sync-request (we want the data)
 *
 * Note: This implementation is "eager" - we request all announced documents.
 * A selective sync implementation could filter here based on user preferences.
 *
 * ## Protocol Flow
 *
 * ```
 * Peer                          Us
 *   |                           |
 *   |-- directory-response ---->|  (this handler)
 *   |   [docId1, docId2]        |  1. Create doc states
 *   |                           |  2. Update peer awareness
 *   |<-- sync-request -----------|  3. Request document data
 *   |   [docId1, docId2]        |
 *   |-- sync-response ---------->|  4. Receive data
 * ```
 *
 * ## Storage Adapter Behavior
 *
 * Storage adapters use this same flow:
 * - Receive directory-response announcement
 * - Immediately request all announced documents (eager)
 * - Persist the data when sync-response arrives
 *
 * ## Selective Sync Example
 *
 * To implement selective sync (e.g., mobile client):
 * ```typescript
 * // Instead of requesting all documents:
 * if (shouldSyncDocument(docId, userPreferences)) {
 *   docsToSync.push({ docId, requesterDocVersion })
 * }
 * ```
 *
 * @see docs/discovery-and-sync-architecture.md - Pattern 1: Client Refresh
 * @see docs/discovery-and-sync-architecture.md - Scenario: Selective Sync
 * @see handle-directory-request.ts - How peers filter announcements
 */

import type {
  ChannelMsgDirectoryResponse,
  ChannelMsgSyncRequest,
} from "../channel.js"
import { isEstablished } from "../channel.js"
import type { Command } from "../synchronizer-program.js"
import { createDocState } from "../types.js"
import { setPeerDocumentAwareness } from "./peer-state-helpers.js"
import type { ChannelHandlerContext } from "./types.js"
import { batchAsNeeded } from "./utils.js"

export function handleDirectoryResponse(
  message: ChannelMsgDirectoryResponse,
  { channel, model, fromChannelId, logger }: ChannelHandlerContext,
): Command | undefined {
  // Require established channel for directory operations
  if (!isEstablished(channel)) {
    logger.warn(
      `rejecting directory-response from non-established channel ${fromChannelId}`,
    )
    return
  }

  const peerState = model.peers.get(channel.peerId)
  if (!peerState) {
    logger.warn(
      `rejecting directory-response: peer state not found for ${channel.peerId}`,
    )
    return
  }

  const commands: (Command | undefined)[] = []
  const docsToSync: ChannelMsgSyncRequest["docs"] = []

  // Process each announced document
  for (const docId of message.docIds) {
    let docState = model.documents.get(docId)

    // Create document state if we don't have it yet
    if (!docState) {
      docState = createDocState({ docId })
      model.documents.set(docId, docState)
      commands.push({ type: "cmd/subscribe-doc", docId })
    }

    // Update peer awareness - peer has revealed they have this document
    // Note: Subscription NOT set yet - they haven't requested from us
    // That will be set when they send sync-request
    setPeerDocumentAwareness(peerState, docId, "has-doc")

    // Since peer has the doc, send our ephemeral state
    commands.push({
      type: "cmd/broadcast-ephemeral",
      docId,
      allPeerData: true,
      hopsRemaining: 0,
      toChannelIds: [fromChannelId],
    })

    logger.debug("directory-response: updated peer awareness", {
      peerId: channel.peerId,
      docId,
      awareness: "has-doc",
    })

    // Add to sync request to actually load the document data
    // This is the "pull" in pull-based discovery - we explicitly request
    docsToSync.push({
      docId,
      requesterDocVersion: docState.doc.version(), // Empty for new docs
    })
  }

  // Send sync-request to load the actual document data
  // This completes the discovery → request → transfer flow
  if (docsToSync.length > 0) {
    commands.push({
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [fromChannelId],
        message: {
          type: "channel/sync-request",
          docs: docsToSync,
        },
      },
    })
  }

  return batchAsNeeded(...commands)
}
