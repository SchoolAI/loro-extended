/**
 * Handle channel-removed - Clean up when a channel is disconnected
 *
 * This is called when a channel (storage adapter or network peer) is being
 * removed from the system. We perform comprehensive cleanup while preserving
 * peer state for potential reconnection.
 *
 * ## Cleanup Steps
 *
 * 1. **De-initialize the channel** - Stop the channel's internal operations
 * 2. **Update peer state** - Mark peer as disconnected, remove channel reference
 * 3. **Remove from model** - Delete channel from synchronizer state
 * 4. **Clean document state** - Remove channel-specific document metadata
 *
 * ## Peer State Preservation
 *
 * When a channel is removed, we:
 * - Keep the peer state (don't delete it)
 * - Update lastSeen timestamp
 * - Remove this channel from peer's channel set
 * - Preserve document awareness cache
 *
 * This enables optimized reconnection - when the peer reconnects via a new
 * channel, we can use cached awareness to skip unchanged documents.
 *
 * ## Document State Cleanup
 *
 * We remove channel-specific state from all documents:
 * - Loading states (found/not-found)
 * - Peer subscriptions
 * - Any other channel-specific metadata
 *
 * This ensures clean state and prevents memory leaks.
 *
 * ## Channel Types
 *
 * This handler works for both:
 * - **Storage adapters** - When storage is disconnected/closed
 * - **Network peers** - When peer disconnects or connection fails
 *
 * @see handle-channel-added.ts - How channels are added
 * @see handle-establish-channel.ts - How channels are established
 */

import type { Logger } from "@logtape/logtape"
import { current } from "mutative"
import { type Channel, isEstablished } from "../channel.js"
import type { Command, SynchronizerModel } from "../synchronizer-program.js"
import { getReadyStates } from "./state-helpers.js"
import { batchAsNeeded } from "./utils.js"

export function handleChannelRemoved(
  msg: { type: "synchronizer/channel-removed"; channel: Channel },
  model: SynchronizerModel,
  logger: Logger,
): Command | undefined {
  // Step 1: De-initialize the channel
  // This stops the channel's internal operations (close connections, etc.)
  const channel = model.channels.get(msg.channel.channelId)

  const commands: Command[] = []

  if (channel) {
    commands.push({
      type: "cmd/stop-channel",
      channel: current(channel),
    })
  } else {
    logger.warn(`channel didn't exist when removing: ${msg.channel.channelId}`)
  }

  // Step 2: Update peer state if channel was established
  // We keep the peer state for reconnection optimization
  if (channel && isEstablished(channel)) {
    const peerState = model.peers.get(channel.peerId)
    if (peerState) {
      // Remove this channel from peer's channel set
      peerState.channels.delete(channel.channelId)
      // Update last seen timestamp
      peerState.lastSeen = new Date()
      // IMPORTANT: Keep peer state even if no channels remain
      // This preserves document awareness cache for reconnection

      // If this was the last channel for this peer, we should remove their ephemeral data
      // This prevents "ghost" cursors/presence from lingering until timeout
      if (peerState.channels.size === 0) {
        commands.push({
          type: "cmd/remove-ephemeral-peer",
          peerId: channel.peerId,
        })
      }
    }
  }

  // Step 3: Remove the channel from our model
  model.channels.delete(msg.channel.channelId)

  // Emit ready-state-changed for all documents since a channel was removed
  for (const docId of model.documents.keys()) {
    commands.push({
      type: "cmd/emit-ready-state-changed",
      docId,
      readyStates: getReadyStates(model.channels, model.peers, docId),
    })
  }

  return batchAsNeeded(...commands)
}
