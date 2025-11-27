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
import { setPeerDocumentAwareness } from "../peer-state-helpers.js"
import { getRuleContext } from "../rule-context.js"
import { getReadyStates } from "../state-helpers.js"
import type { ChannelHandlerContext } from "../types.js"
import { batchAsNeeded } from "../utils.js"

export function handleSyncResponse(
  message: ChannelMsgSyncResponse,
  { channel, model, fromChannelId, rules, logger }: ChannelHandlerContext,
): Command | undefined {
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

  // Handle different transmission types
  switch (message.transmission.type) {
    case "up-to-date": {
      // CASE 1: Document is already up to date
      // Peer has the document and our version matches theirs
      // No data to apply, just update metadata

      // Update peer awareness for reconnection optimization
      setPeerDocumentAwareness(
        peerState,
        message.docId,
        "has-doc",
        message.transmission.version,
      )

      break
    }

    case "snapshot":
    case "update": {
      // CASE 2: Peer is sending us document data
      // Either full snapshot or delta update

      if (!docState) {
        logger.warn(
          `sync-response: docState missing for ${message.docId} (should have been created)`,
        )
        return
      }

      // Check canUpdate permission before applying data
      // This enforces write rules and enables read-only replicas
      const context = getRuleContext({ channel, docState, model })
      if (context instanceof Error) {
        logger.warn(`can't check canUpdate: ${context.message}`)
        return
      }
      if (!rules.canUpdate(context)) {
        logger.warn(`rejecting update from ${context.peerName}`)
        return
      }

      // Update peer awareness with new version
      // We use the version sent by the peer, not our local version
      // Our local version might include changes the peer doesn't have yet
      setPeerDocumentAwareness(
        peerState,
        message.docId,
        "has-doc",
        message.transmission.version,
      )

      // IMPORTANT: Defer the import to a command!
      // The import must happen AFTER the model update is committed (including the
      // peer awareness update above). If we import synchronously here, the doc.subscribe()
      // callback will trigger a doc-change event that runs with the OLD model state
      // (before peer awareness is updated), causing an echo loop where we think the
      // peer is behind and send the update back to them.
      commands.push({
        type: "cmd/import-doc-data",
        docId: message.docId,
        data: message.transmission.data,
      })

      break
    }

    case "unavailable": {
      // CASE 3: Peer doesn't have the document (yet)
      // We requested but peer doesn't have it
      //
      // IMPORTANT: Don't change subscriptions!
      // - Keep subscription (we sent sync-request)
      // - This ensures future updates will be sent when document is created
      // - Particularly important for storage adapters that request before persisting

      // Update peer awareness - peer explicitly doesn't have this doc
      setPeerDocumentAwareness(peerState, message.docId, "no-doc")
      break
    }
  }

  // Emit ready-state-changed event
  // This notifies listeners (like waitForNetwork) that the document state has changed
  const readyStates = getReadyStates(model, message.docId)
  commands.push({
    type: "cmd/emit-ready-state-changed",
    docId: message.docId,
    readyStates,
  })

  return batchAsNeeded(...commands)
}
