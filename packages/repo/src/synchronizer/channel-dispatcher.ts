import type { Logger } from "@logtape/logtape"
import { omit } from "lodash-es"
import { type ChannelMsg, isEstablished } from "../channel.js"
import type { Permissions } from "../permissions.js"
import type { Command, SynchronizerModel } from "../synchronizer-program.js"
import type { ChannelId } from "../types.js"
import { handleEstablishRequest } from "./connection/handle-establish-request.js"
import { handleEstablishResponse } from "./connection/handle-establish-response.js"
import { handleDirectoryRequest } from "./discovery/handle-directory-request.js"
import { handleDirectoryResponse } from "./discovery/handle-directory-response.js"
import { handleNewDoc } from "./discovery/handle-new-doc.js"
import { handleEphemeral } from "./ephemeral/handle-ephemeral.js"
import { handleDeleteRequest } from "./sync/handle-delete-request.js"
import { handleSyncRequest } from "./sync/handle-sync-request.js"
import { handleSyncResponse } from "./sync/handle-sync-response.js"
import { handleSyncUpdate } from "./sync/handle-sync-update.js"
import type {
  ChannelHandlerContext,
  EstablishedHandlerContext,
} from "./types.js"
import { batchAsNeeded } from "./utils.js"

/**
 * Dispatches channel protocol messages to their handlers
 *
 * Channel messages implement the discovery and sync protocol between peers.
 * This function:
 * 1. Validates the channel exists
 * 2. Logs the message for debugging
 * 3. Routes to the appropriate handler based on message type
 *
 * ## Message Types
 *
 * **Establishment** (connection setup):
 * - `establish-request` - Peer wants to connect
 * - `establish-response` - Connection accepted
 *
 * **Discovery** (what documents exist):
 * - `directory-request` - Ask peer what documents they have
 * - `directory-response` - Announce documents (filtered by visibility)
 *
 * **Sync** (transfer document data):
 * - `sync-request` - Request document data
 * - `sync-response` - Send document data (filtered by mutability)
 *
 * @see docs/discovery-and-sync-architecture.md for protocol details
 */
export function channelDispatcher(
  channelMessage: ChannelMsg,
  model: SynchronizerModel,
  fromChannelId: ChannelId,
  permissions: Permissions,
  logger: Logger,
): Command | undefined {
  const channel = model.channels.get(fromChannelId)

  if (!channel) {
    logger.warn(
      "channel not found corresponding to from-channel-id: {fromChannelId}",
      { fromChannelId },
    )
    return
  }

  // Determine sender name for logging
  const from = isEstablished(channel)
    ? model.peers.get(channel.peerId)?.identity.name
    : channelMessage.type === "channel/establish-request"
      ? channelMessage.identity.name
      : channelMessage.type === "channel/establish-response"
        ? channelMessage.identity.name
        : "unknown"

  // Log all channel messages for debugging
  logger.trace("Received {type} from {from} via {via}", {
    type: channelMessage.type,
    from,
    to: model.identity.name,
    via: fromChannelId,
    dir: "recv",
    channelMessage: omit(channelMessage, "type"),
  })

  // Build context for establishment handlers (any channel state)
  const ctx: ChannelHandlerContext = {
    channel,
    model,
    fromChannelId,
    permissions,
    logger,
  }

  // Route establishment messages - these work with any channel state
  switch (channelMessage.type) {
    case "channel/establish-request":
      return handleEstablishRequest(channelMessage, ctx)

    case "channel/establish-response":
      return handleEstablishResponse(channelMessage, ctx)

    case "channel/batch":
      // Dispatch each message in the batch and collect commands
      // This allows multiple messages to be sent in a single network payload
      // while still being processed individually by their handlers
      return batchAsNeeded(
        ...channelMessage.messages.map(msg =>
          channelDispatcher(msg, model, fromChannelId, permissions, logger),
        ),
      )
  }

  // All other messages require an established channel
  // Single validation point - not repeated in handlers!
  if (!isEstablished(channel)) {
    logger.warn(
      `rejecting ${channelMessage.type} from non-established channel ${fromChannelId}`,
    )
    return
  }

  const peerState = model.peers.get(channel.peerId)
  if (!peerState) {
    logger.warn(
      `rejecting ${channelMessage.type}: peer state not found for ${channel.peerId}`,
    )
    return
  }

  // Build established context with narrowed types
  const establishedCtx: EstablishedHandlerContext = {
    channel, // TypeScript knows this is EstablishedChannel
    peerState, // Guaranteed to exist
    model,
    fromChannelId,
    permissions,
    logger,
  }

  // Route to handlers that require established channel
  switch (channelMessage.type) {
    case "channel/sync-request":
      return handleSyncRequest(channelMessage, establishedCtx)

    case "channel/sync-response":
      return handleSyncResponse(channelMessage, establishedCtx)

    case "channel/update":
      return handleSyncUpdate(channelMessage, establishedCtx)

    case "channel/directory-request":
      return handleDirectoryRequest(channelMessage, establishedCtx)

    case "channel/directory-response":
      return handleDirectoryResponse(channelMessage, establishedCtx)

    case "channel/new-doc":
      return handleNewDoc(channelMessage, establishedCtx)

    case "channel/ephemeral":
      return handleEphemeral(channelMessage, establishedCtx)

    case "channel/delete-request":
      return handleDeleteRequest(channelMessage, establishedCtx)

    case "channel/delete-response":
      // Delete responses are informational - log and continue
      logger.info("delete-response received: {docId} status={status}", {
        docId: channelMessage.docId,
        status: channelMessage.status,
      })
      return
  }
}
