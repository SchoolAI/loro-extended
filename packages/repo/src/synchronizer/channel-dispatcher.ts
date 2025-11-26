import type { Logger } from "@logtape/logtape"
import { omit } from "lodash-es"
import { type ChannelMsg, isEstablished } from "../channel.js"
import type { Rules } from "../rules.js"
import type { Command, SynchronizerModel } from "../synchronizer-program.js"
import type { ChannelId } from "../types.js"
import { handleEstablishRequest } from "./connection/handle-establish-request.js"
import { handleEstablishResponse } from "./connection/handle-establish-response.js"
import { handleDirectoryRequest } from "./discovery/handle-directory-request.js"
import { handleDirectoryResponse } from "./discovery/handle-directory-response.js"
import { handleEphemeral } from "./ephemeral/handle-ephemeral.js"
import { handleSyncRequest } from "./sync/handle-sync-request.js"
import { handleSyncResponse } from "./sync/handle-sync-response.js"
import type { ChannelHandlerContext } from "./types.js"

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
 * - `directory-response` - Announce documents (filtered by canReveal)
 *
 * **Sync** (transfer document data):
 * - `sync-request` - Request document data
 * - `sync-response` - Send document data (filtered by canUpdate)
 *
 * @see docs/discovery-and-sync-architecture.md for protocol details
 */
export function channelDispatcher(
  channelMessage: ChannelMsg,
  model: SynchronizerModel,
  fromChannelId: ChannelId,
  permissions: Rules,
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

  // Build context for handlers
  const ctx: ChannelHandlerContext = {
    channel,
    model,
    fromChannelId,
    permissions,
    logger,
  }

  // Route to appropriate handler
  // Each handler is in its own file under src/synchronizer/
  switch (channelMessage.type) {
    case "channel/establish-request":
      return handleEstablishRequest(channelMessage, ctx)

    case "channel/establish-response":
      return handleEstablishResponse(channelMessage, ctx)

    case "channel/sync-request":
      return handleSyncRequest(channelMessage, ctx)

    case "channel/sync-response":
      return handleSyncResponse(channelMessage, ctx)

    case "channel/directory-request":
      return handleDirectoryRequest(channelMessage, ctx)

    case "channel/directory-response":
      return handleDirectoryResponse(channelMessage, ctx)

    case "channel/ephemeral":
      return handleEphemeral(channelMessage, ctx)
  }
  return
}
