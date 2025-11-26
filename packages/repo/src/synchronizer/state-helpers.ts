import type { Channel } from "../channel.js"
import { isEstablished } from "../channel.js"
import type {
  ChannelId,
  DocId,
  LoadingState,
  PeerID,
  PeerState,
  ReadyState,
} from "../types.js"

/**
 * Get ready states for all channels for a document
 *
 * Converts peer-centric state (documentAwareness) to channel-centric UI state (ReadyState[])
 */
export function getReadyStates(
  channels: Map<ChannelId, Channel>,
  peers: Map<PeerID, PeerState>,
  docId: DocId,
): ReadyState[] {
  const readyStates: ReadyState[] = []

  for (const channel of channels.values()) {
    if (!isEstablished(channel)) continue

    const peer = peers.get(channel.peerId)
    const awareness = peer?.documentAwareness.get(docId)

    // Convert peer awareness to loading state for UI
    let loading: LoadingState

    if (!awareness) {
      loading = { state: "initial" }
    } else if (awareness.awareness === "has-doc") {
      const version = awareness.lastKnownVersion
      if (version) {
        loading = { state: "found", version }
      } else {
        loading = { state: "requesting" }
      }
    } else if (awareness.awareness === "no-doc") {
      loading = { state: "not-found" }
    } else {
      loading = { state: "initial" }
    }

    readyStates.push({
      channelMeta: {
        kind: channel.kind,
        adapterId: channel.adapterId,
      },
      loading,
    })
  }

  return readyStates
}
