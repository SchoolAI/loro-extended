/**
 * Handle establish-channel - Initiate connection handshake
 *
 * This is the second phase of channel initialization. After a channel has been
 * added to the system, this handler sends the establish-request to begin the
 * connection handshake.
 *
 * ## Two-Phase Channel Initialization
 *
 * 1. **channel-added** - Register the channel in the model
 * 2. **establish-channel** (this handler) - Send establish-request
 *
 * This separation allows the caller to control when the handshake begins.
 *
 * ## Connection Handshake
 *
 * After sending establish-request, the protocol flow is:
 * ```
 * Us                            Peer/Storage
 *   |                           |
 *   |-- establish-request ----->|  (this handler sends)
 *   |   [our identity]          |
 *   |                           |
 *   |<-- establish-response ----|  (peer responds)
 *   |   [their identity]        |
 *   |                           |
 *   |-- directory-request ----->|  (we discover their docs)
 *   |-- sync-request ---------->|  (we request our docs)
 * ```
 *
 * ## Identity Exchange
 *
 * The establish-request includes our identity (name, peerId), which:
 * - Provides a stable peer identifier across reconnections
 * - Enables peer awareness caching for optimized reconnection
 * - Allows permission rules to identify the peer
 *
 * ## Usage
 *
 * Typically called immediately after channel-added, but can be delayed:
 * ```typescript
 * // Add channel
 * dispatch({ type: "synchronizer/channel-added", channel })
 *
 * // Start handshake (can be delayed if needed)
 * dispatch({ type: "synchronizer/establish-channel", channelId })
 * ```
 *
 * @see handle-channel-added.ts - Phase 1: Register channel
 * @see handle-establish-request.ts - How peer responds to our request
 * @see handle-establish-response.ts - How we handle their response
 */

import type { Logger } from "@logtape/logtape"
import { current } from "mutative"
import type { Command, SynchronizerModel } from "../synchronizer-program.js"
import type { ChannelId } from "../types.js"

export function handleEstablishChannel(
  msg: { type: "synchronizer/establish-channel"; channelId: ChannelId },
  model: SynchronizerModel,
  logger: Logger,
): Command | undefined {
  // Look up the channel
  const channel = model.channels.get(msg.channelId)
  if (!channel) {
    logger.warn("establish-channel: channel {channelId} not found", {
      channelId: msg.channelId,
    })
    return
  }

  // Send establish-request to begin handshake
  // Note: We use current() to safely extract identity from mutative context
  return {
    type: "cmd/send-establishment-message",
    envelope: {
      toChannelIds: [msg.channelId],
      message: {
        type: "channel/establish-request",
        identity: current(model.identity),
      },
    },
  }
}
