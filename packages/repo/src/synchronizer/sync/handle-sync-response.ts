/**
 * Handle sync-response - Receive document data from a peer
 *
 * This is the response to our sync-request. The peer is sending us document data
 * (or telling us they don't have it, or it's up-to-date).
 *
 * ## Transmission Types
 *
 * 1. **snapshot** - Full document (peer sent everything)
 *    - Used when we have empty version (new document)
 *    - Contains complete document state
 *
 * 2. **update** - Delta from our version
 *    - Used when we have non-empty version
 *    - Contains only changes since our version
 *
 * 3. **up-to-date** - No changes needed
 *    - Our version matches peer's version
 *    - No data transferred
 *
 * 4. **unavailable** - Peer doesn't have this document
 *    - We requested but peer doesn't have it (yet)
 *    - Important: Keep subscription for future updates
 *
 * ## Permission Checking
 *
 * Before applying snapshot/update data, we check `canUpdate` permission:
 * - Enforces write rules (who can send us data)
 * - Enables read-only replicas
 * - Prevents unauthorized updates
 *
 * ## Storage Adapter Behavior
 *
 * Storage adapters:
 * - Receive sync-response for all requested documents
 * - Apply and persist the data
 * - Keep subscriptions for future updates
 *
 * ## Protocol Flow
 *
 * ```
 * Us                            Peer
 *   |                           |
 *   |-- sync-request ---------->|
 *   |                           |
 *   |<-- sync-response ---------|  (this handler)
 *   |   [snapshot/update/       |  1. Check rules
 *   |    up-to-date/unavailable]|  2. Apply data (if any)
 *   |                           |  3. Update peer awareness
 *   |                           |  4. Emit ready-state-changed
 * ```
 *
 * @see docs/discovery-and-sync-architecture.md - Sync Data Transfer
 * @see handle-sync-request.ts - How peers respond to our requests
 */

import type { ChannelMsgSyncResponse } from "../../channel.js"
import { isEstablished } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { createDocState } from "../../types.js"
import type { ChannelHandlerContext } from "../types.js"
import { batchAsNeeded } from "../utils.js"
import { applySyncTransmission } from "./utils.js"

export function handleSyncResponse(
  message: ChannelMsgSyncResponse,
  context: ChannelHandlerContext,
): Command | undefined {
  const { channel, model, fromChannelId, logger } = context

  // Require established channel for sync operations
  if (!isEstablished(channel)) {
    logger.warn(
      `rejecting sync-response from non-established channel ${fromChannelId}`,
    )
    return
  }

  const peerState = model.peers.get(channel.peerId)
  if (!peerState) {
    logger.warn(
      `rejecting sync-response: peer state not found for ${channel.peerId}`,
    )
    return
  }

  let docState = model.documents.get(message.docId)
  const commands: Command[] = []

  // Create document state if we don't have it yet
  // This can happen when peer announces a document we didn't know about
  if (!docState) {
    // Only create the document if the peer actually sent data
    // If they sent "unavailable" or "up-to-date", we shouldn't create a new document
    // (especially if we just deleted it locally)
    const shouldCreate =
      message.transmission.type === "snapshot" ||
      message.transmission.type === "update"

    if (shouldCreate) {
      logger.debug("sync-response: creating new document from peer", {
        docId: message.docId,
        peerId: channel.peerId,
      })
      docState = createDocState({ docId: message.docId })
      model.documents.set(message.docId, docState)
      commands.push({
        type: "cmd/subscribe-doc",
        docId: message.docId,
      })
    }
  }

  // Apply the sync transmission
  commands.push(...applySyncTransmission(message, context))

  // Apply incoming ephemeral data if provided in the sync-response
  // This contains all known presence data from the responder
  if (message.ephemeral) {
    logger.debug(
      "sync-response: applying ephemeral data from {peerId} for {docId}",
      {
        peerId: channel.peerId,
        docId: message.docId,
      },
    )
    commands.push({
      type: "cmd/apply-ephemeral",
      docId: message.docId,
      data: message.ephemeral,
    })
  }

  return batchAsNeeded(...commands)
}
