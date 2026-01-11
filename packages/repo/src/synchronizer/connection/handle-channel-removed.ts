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
 * 5. **Handle storage-first sync** - Process pending requests if storage disconnects
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
 * - Pending storage channels (for storage-first sync)
 * - Any other channel-specific metadata
 *
 * This ensures clean state and prevents memory leaks.
 *
 * ## Storage-First Sync Cleanup
 *
 * If a storage channel is removed while documents are waiting for its response:
 * - Remove the channel from pendingStorageChannels
 * - If no more storage channels pending, process pending network requests
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
import { type Channel, isEstablished } from "../../channel.js"
import type { Command, SynchronizerModel } from "../../synchronizer-program.js"
import type { DocId } from "../../types.js"
import { batchAsNeeded } from "../utils.js"

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
    logger.warn("channel didn't exist when removing: {channelId}", {
      channelId: msg.channel.channelId,
    })
  }

  const affectedDocIds: Set<DocId> = new Set()

  // Step 2: Update peer state if channel was established
  // We keep the peer state for reconnection optimization
  if (channel && isEstablished(channel)) {
    const peerState = model.peers.get(channel.peerId)
    if (peerState) {
      // Remove this channel from peer's channel set
      peerState.channels.delete(channel.channelId)

      // If this was the last channel for this peer, we should remove their ephemeral data
      // This prevents "ghost" cursors/presence from lingering until timeout
      if (peerState.channels.size === 0) {
        commands.push({
          type: "cmd/remove-ephemeral-peer",
          peerId: channel.peerId,
        })
      }

      // Track which documents may be affected by this channel removal
      for (const docId of peerState.docSyncStates.keys()) {
        affectedDocIds.add(docId)
      }

      // IMPORTANT: Keep peer state even if no channels remain
      // This preserves document awareness cache for reconnection
    }
  }

  // Step 3: Handle storage-first sync cleanup
  // If this channel was a storage channel that documents were waiting for,
  // we need to remove it from pendingStorageChannels and potentially process
  // pending network requests
  const removedChannelId = msg.channel.channelId
  for (const [docId, docState] of model.documents) {
    if (docState.pendingStorageChannels?.has(removedChannelId)) {
      // Remove this storage channel from pending set
      docState.pendingStorageChannels.delete(removedChannelId)

      logger.debug(
        "channel-removed: removed storage channel {channelId} from pending set for {docId}, {remaining} remaining",
        {
          channelId: removedChannelId,
          docId,
          remaining: docState.pendingStorageChannels.size,
        },
      )

      // If no more storage channels pending, process pending network requests
      if (docState.pendingStorageChannels.size === 0) {
        const pendingRequests = docState.pendingNetworkRequests ?? []

        if (pendingRequests.length > 0) {
          logger.debug(
            "channel-removed: all storage responded for {docId}, processing {count} pending network request(s)",
            {
              docId,
              count: pendingRequests.length,
            },
          )

          // Send sync-response to all pending network requests
          for (const req of pendingRequests) {
            commands.push({
              type: "cmd/send-sync-response",
              toChannelId: req.channelId,
              docId,
              requesterDocVersion: req.requesterDocVersion,
              includeEphemeral: true,
            })
          }

          // Clear the pending requests
          docState.pendingNetworkRequests = []
        }

        // Clear the pending storage channels set
        docState.pendingStorageChannels = undefined
      }
    }

    // Also clean up pending network requests from this channel if it was a network channel
    if (docState.pendingNetworkRequests) {
      const originalLength = docState.pendingNetworkRequests.length
      docState.pendingNetworkRequests = docState.pendingNetworkRequests.filter(
        req => req.channelId !== removedChannelId,
      )
      if (docState.pendingNetworkRequests.length < originalLength) {
        logger.debug(
          "channel-removed: removed pending network request from {docId} for disconnected channel {channelId}",
          {
            docId,
            channelId: removedChannelId,
          },
        )
      }
    }
  }

  // Step 4: Remove the channel from our model
  model.channels.delete(msg.channel.channelId)

  return batchAsNeeded(...commands)
}
