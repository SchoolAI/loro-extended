import type { ChannelMsgUpdate } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import type { ChannelHandlerContext } from "../types.js"
import { batchAsNeeded } from "../utils.js"
import { applySyncTransmission } from "./utils.js"

/**
 * Handle sync-update - Receive spontaneous document updates from a peer
 *
 * This is used for ongoing updates AFTER the initial sync handshake.
 * Unlike sync-response, this does NOT trigger initialization logic like
 * broadcasting ephemeral state.
 */
export function handleSyncUpdate(
  message: ChannelMsgUpdate,
  context: ChannelHandlerContext,
): Command | undefined {
  const commands = applySyncTransmission(message, context)
  return batchAsNeeded(...commands)
}
