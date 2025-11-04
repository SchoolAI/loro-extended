/**
 * Handle channel-added - Register a new channel in the synchronizer
 *
 * This is called when a new channel (storage adapter or network peer) is added
 * to the system. We simply register it in our model without initiating any
 * protocol messages.
 *
 * ## Two-Phase Channel Initialization
 *
 * Channel setup happens in two phases:
 * 1. **channel-added** (this handler) - Register the channel
 * 2. **establish-channel** - Send establish-request to start handshake
 *
 * This separation allows the caller to control when the handshake begins,
 * which is useful for:
 * - Batching multiple channel additions
 * - Delaying establishment until ready
 * - Testing scenarios
 *
 * ## Channel Types
 *
 * Channels can be:
 * - **Storage adapters** - Local persistence (IndexedDB, LevelDB, etc.)
 * - **Network peers** - Remote synchronization (SSE, WebSocket, etc.)
 *
 * Both types follow the same channel protocol but may have different
 * permission rules (e.g., storage can see all docs, peers may be restricted).
 *
 * @see handle-establish-channel.ts - Phase 2: Start handshake
 * @see handle-channel-removed.ts - Cleanup when channel is removed
 */

import type { ConnectedChannel } from "../channel.js"
import type { SynchronizerModel } from "../synchronizer-program.js"

export function handleChannelAdded(
  msg: { type: "synchronizer/channel-added"; channel: ConnectedChannel },
  model: SynchronizerModel,
): undefined {
  // Register the channel in our model
  // Note: We don't send establish-request yet - that happens in establish-channel
  model.channels.set(msg.channel.channelId, msg.channel)
  return
}
