/**
 * Handle sync-request - Peer explicitly requests document data
 *
 * This is the "pull" in the pull-based sync model. The peer has discovered
 * a document (via directory-response) and now explicitly requests the data.
 *
 * ## Key Behaviors
 *
 * 1. **Send sync-response** with document data (snapshot or update)
 * 2. **Add to peer's subscriptions** - Peer has subscribed to this document
 * 3. **Update peer awareness** - Track that peer has this document
 *
 * ## Subscription Model
 *
 * When a peer sends sync-request, they're implicitly subscribing to future updates:
 * - We add the document to the peer's `subscriptions` set
 * - Future local changes will send sync-response directly (real-time updates)
 * - No need for announcements - peer already knows about the document
 *
 * ## Version Vector Semantics
 *
 * The `requesterDocVersion` tells us what the peer has:
 * - **Empty version**: Peer has nothing → send snapshot (full document)
 * - **Non-empty version**: Peer has this version → send update (delta)
 * - **Up-to-date**: Peer has latest → send "up-to-date" response
 *
 * ## Protocol Flow
 *
 * ```
 * Peer                          Us
 *   |                           |
 *   |-- sync-request ---------->|  (this handler)
 *   |   [docId, version]        |  1. Check if we have doc
 *   |                           |  2. Add to peer's subscriptions
 *   |                           |  3. Update peer awareness
 *   |<-- sync-response ---------|  4. Send document data
 *   |   [data or up-to-date]    |
 *   |                           |
 *   |<-- sync-response ---------|
 *   |   [data or up-to-date]    |
 *   |                           |
 *   |<-- sync-response ---------|
 *   |   [data or up-to-date]    |
 * ```
 *
 * ## Storage Adapter Behavior
 *
 * Storage adapters:
 * - Send sync-request for all announced documents (eager)
 * - Always have subscriptions after first request
 * - Receive all future updates automatically
 *
 * @see docs/discovery-and-sync-architecture.md - Sync Data Transfer
 * @see handle-sync-response.ts - How we handle responses from peers
 * @see handle-local-doc-change.ts - How we send updates to subscribed peers
 */

import type { ChannelMsgSyncRequest } from "../channel.js"
import { isEstablished } from "../channel.js"
import type { Command } from "../synchronizer-program.js"
import {
  addPeerSubscription,
  setPeerDocumentAwareness,
} from "./peer-state-helpers.js"
import type { ChannelHandlerContext } from "./types.js"
import { batchAsNeeded } from "./utils.js"

export function handleSyncRequest(
  message: ChannelMsgSyncRequest,
  { channel, model, fromChannelId, logger }: ChannelHandlerContext,
): Command | undefined {
  // Require established channel for sync operations
  if (!isEstablished(channel)) {
    return {
      type: "cmd/log",
      message: `rejecting sync-request from non-established channel ${fromChannelId}`,
    }
  }

  const peerState = model.peers.get(channel.peerId)
  if (!peerState) {
    return {
      type: "cmd/log",
      message: `rejecting sync-request: peer state not found for ${channel.peerId}`,
    }
  }

  const { docs } = message
  const commands: (Command | undefined)[] = []

  // Process each requested document
  for (const { docId, requesterDocVersion } of docs) {
    // ALWAYS track subscription and awareness
    // The peer is explicitly telling us they want this document and what version they have
    // This ensures that if we get the document later, we know to send it to them
    addPeerSubscription(peerState, docId)
    setPeerDocumentAwareness(peerState, docId, "has-doc", requesterDocVersion)

    logger.debug("sync-request: updated peer awareness and subscription", {
      peerId: channel.peerId,
      docId,
      awareness: "has-doc",
    })

    const docState = model.documents.get(docId)

    if (docState) {
      logger.debug("sending sync-response due to channel/sync-request", {
        docId,
        peerId: channel.peerId,
      })

      // 1. Send sync-response with document data
      // The cmd/send-sync-response command will determine whether to send
      // a snapshot (full doc) or update (delta) based on requesterDocVersion
      commands.push({
        type: "cmd/send-sync-response",
        toChannelId: fromChannelId,
        docId,
        requesterDocVersion,
      })
    }
    // If we don't have the document, we simply don't respond (yet)
    // But we have recorded their interest, so if we get it later, we'll send it
  }

  return batchAsNeeded(...commands)
}
