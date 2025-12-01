/**
 * Handle establish-response - Complete connection handshake (client side)
 *
 * This is the response to our establish-request. The peer has accepted our connection
 * and sent us their identity. Now we can start syncing documents.
 *
 * ## Two Connection Paths
 *
 * ### 1. New Peer (First Connection)
 * - No cached peer state exists
 * - Send sync-request for all our documents
 * - Send ephemeral (presence) data
 *
 * ### 2. Reconnection (Known Peer)
 * - Cached peer state exists with document awareness
 * - Send optimized sync-request only for:
 *   - New documents created since last connection
 *   - Documents that changed since last connection (version comparison)
 * - Also send ephemeral (presence) data
 *
 * ## Protocol Flow (New Peer)
 *
 * ```
 * Us                            Peer
 *   |                           |
 *   |-- establish-request ----->|
 *   |                           |
 *   |<-- establish-response ----|  (this handler)
 *   |   [peer identity]         |  1. Mark channel as established
 *   |                           |  2. Create/update peer state
 *   |                           |  3. Send sync-request (all docs)
 *   |                           |  4. Send our presence data (all docs)
 *   |-- sync-request ---------->|
 * ```
 *
 * ## Protocol Flow (Reconnection)
 *
 * ```
 * Us                            Peer
 *   |                           |
 *   |-- establish-request ----->|
 *   |                           |
 *   |<-- establish-response ----|  (this handler)
 *   |   [peer identity]         |  1. Mark channel as established
 *   |                           |  2. Update peer state (lastSeen)
 *   |                           |  3. Send optimized sync-request
 *   |-- sync-request ---------->|  4. Send our presence data (a docs)
 *   |   [only new/changed docs] |
 * ```
 *
 * @see docs/discovery-and-sync-architecture.md - Connection Establishment
 * @see handle-establish-request.ts - Server side of handshake
 */

import type {
  ChannelMsgEstablishResponse,
  ChannelMsgSyncRequest,
  EstablishedChannel,
} from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { ensurePeerState } from "../peer-state-helpers.js"
import type { ChannelHandlerContext } from "../types.js"
import {
  batchAsNeeded,
  filterAllowedDocs,
  getAllDocsToSync,
  getChangedDocsToSync,
} from "../utils.js"

export function handleEstablishResponse(
  message: ChannelMsgEstablishResponse,
  { channel, model, logger, rules }: ChannelHandlerContext,
): Command | undefined {
  const commands: Command[] = []

  // This handler's main job!
  // Mark the channel as established, and remember the peer identity
  const peerId = message.identity.peerId
  const establishedChannel: EstablishedChannel = {
    ...channel,
    type: "established",
    peerId,
  }
  Object.assign(channel, establishedChannel)

  // Check if this is a reconnection to a known peer
  const isReconnection = model.peers.has(peerId)

  // Get or create our representation of the remote peer's state
  const peerState = ensurePeerState(model, message.identity, channel.channelId)

  // Note: We don't set canReveal or subscriptions during establishment
  // - canReveal will be checked on-the-fly when needed
  // - Subscriptions will be set when peer sends sync-request

  let docsToSync: ChannelMsgSyncRequest["docs"] = []

  // Filter documents based on canReveal permission
  const allowedDocs = filterAllowedDocs(
    model.documents,
    establishedChannel,
    model,
    rules,
  )

  if (!isReconnection) {
    // ============================================================
    // NEW PEER PATH - Full discovery
    // ============================================================

    // Build full sync request--ask for all documents we have
    docsToSync = getAllDocsToSync(allowedDocs)

    logger.debug(
      "establish-response (new peer): sending full sync-request to {peerId} for {docCount} docs ({docIds})",
      () => ({
        peerId,
        docCount: docsToSync.length,
        docIds: docsToSync.map(d => d.docId),
      }),
    )
  } else {
    // ============================================================
    // RECONNECTION PATH - Optimized discovery using cached awareness
    // ============================================================

    // Build optimized sync request based on cached knowledge
    docsToSync = getChangedDocsToSync(peerState, allowedDocs)

    if (docsToSync.length > 0) {
      logger.debug(
        "establish-response (known peer): sending optimized sync-request to {peerId} for {docCount} docs ({docIds})",
        () => ({
          peerId,
          docCount: docsToSync.length,
          docIds: docsToSync.map(d => d.docId),
        }),
      )
    } else {
      logger.debug(
        "establish-response (known peer): no sync needed for reconnection",
        {
          channelId: channel.channelId,
        },
      )
    }
  }

  // Request our docs from peer, and suggest a reciprocal sync-request
  // for bidirectional syncing
  // Use cmd/send-sync-request to include ephemeral data with the request
  if (docsToSync.length > 0) {
    commands.push({
      type: "cmd/send-sync-request",
      toChannelId: channel.channelId,
      docs: docsToSync,
      bidirectional: true,
      includeEphemeral: true,
    })
  }

  return batchAsNeeded(...commands)
}
