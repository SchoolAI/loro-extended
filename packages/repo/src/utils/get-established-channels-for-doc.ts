import { type Channel, isEstablished } from "../channel.js"
import type { ChannelId, DocId, PeerID, PeerState } from "../types.js"

export function getEstablishedChannelsForDoc(
  channels: Map<ChannelId, Channel>,
  peers: Map<PeerID, PeerState>,
  docId: DocId,
) {
  // Get all established channels for this document
  const channelIds: ChannelId[] = []

  for (const [channelId, channel] of channels) {
    if (isEstablished(channel)) {
      const peerState = peers.get(channel.peerId)
      if (peerState?.subscriptions.has(docId)) {
        channelIds.push(channelId)
      }
    }
  }

  return channelIds
}
