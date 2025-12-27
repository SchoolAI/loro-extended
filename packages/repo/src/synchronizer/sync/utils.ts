import {
  type ChannelMsgSyncResponse,
  type ChannelMsgUpdate,
  isEstablished,
} from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { setPeerDocumentAwareness } from "../peer-state-helpers.js"
import { getPermissionContext } from "../permission-context.js"
import type { ChannelHandlerContext } from "../types.js"

/**
 * Shared logic for applying sync transmissions (snapshot/update/up-to-date)
 * Used by both handle-sync-response (initial sync) and handle-update (ongoing updates)
 */
export function applySyncTransmission(
  message: ChannelMsgSyncResponse | ChannelMsgUpdate,
  { channel, model, permissions, logger }: ChannelHandlerContext,
): Command[] {
  if (!isEstablished(channel)) {
    logger.warn(
      `rejecting sync transmission from non-established channel ${channel.channelId}`,
    )
    return []
  }

  const peerState = model.peers.get(channel.peerId)
  if (!peerState) {
    logger.warn(
      `rejecting sync transmission: peer state not found for ${channel.peerId}`,
    )
    return []
  }

  const docState = model.documents.get(message.docId)
  const commands: Command[] = []

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
          `sync transmission: docState missing for ${message.docId} (should have been created)`,
        )
        return []
      }

      // Check mutability permission before applying data
      // This enforces write rules and enables read-only replicas
      const context = getPermissionContext({ channel, docState, model })
      if (context instanceof Error) {
        logger.warn(`can't check mutability: ${context.message}`)
        return []
      }
      if (!permissions.mutability(context.doc, context.peer)) {
        logger.warn(`rejecting update from ${context.peer.peerName}`)
        return []
      }

      // IMPORTANT: Import and propagation strategy
      //
      // We use a two-phase approach to prevent echo loops:
      // 1. Import the data via cmd/import-doc-data
      // 2. After import, dispatch doc-imported to propagate to OTHER peers
      //
      // Peer awareness is updated AFTER import via cmd/update-peer-awareness-after-import
      // to ensure we set it to our CURRENT version (which includes both local and imported
      // changes), preventing the echo loop.
      commands.push({
        type: "cmd/import-doc-data",
        docId: message.docId,
        data: message.transmission.data,
        fromPeerId: channel.peerId,
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

  return commands
}
