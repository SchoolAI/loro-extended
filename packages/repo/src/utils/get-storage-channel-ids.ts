import { type Channel, isEstablished } from "../channel.js"
import type { ChannelId } from "../types.js"

/**
 * Get all established storage channel IDs.
 *
 * Used by the storage-first sync feature to determine which storage adapters
 * need to be consulted before responding to network sync-requests.
 */
export function getStorageChannelIds(
  channels: Map<ChannelId, Channel>,
): ChannelId[] {
  const storageChannelIds: ChannelId[] = []

  for (const [channelId, channel] of channels) {
    if (isEstablished(channel) && channel.kind === "storage") {
      storageChannelIds.push(channelId)
    }
  }

  return storageChannelIds
}
