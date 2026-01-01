import type { SynchronizerModel } from "src/synchronizer-program.js"
import type { DocId, ReadyState, ReadyStateChannelMeta } from "../types.js"

/**
 * Get ready states for all channels for a document
 *
 * Converts peer-centric state (documentAwareness) to channel-centric UI state (ReadyState[])
 */
export function getReadyStates(
  model: SynchronizerModel,
  docId: DocId,
): ReadyState[] {
  const readyStates: ReadyState[] = []

  /**
   * 1. Include ready state of the document in our own repo
   *
   * Note: there is no "unknown" state with regard to our own repo--we can always positively conclude that we
   * either have the document (aware/loaded) or we do not have the document (absent).
   */
  const myDoc = model.documents.get(docId)
  if (!myDoc) {
    readyStates.push({
      status: "absent",
      docId,
      identity: { ...model.identity },
      channels: [], // Local repo has no channels
    })
  } else {
    if (myDoc.doc.opCount() > 0) {
      readyStates.push({
        status: "synced",
        docId,
        identity: { ...model.identity },
        channels: [],
      })
    } else {
      readyStates.push({
        status: "pending",
        docId,
        identity: { ...model.identity },
        channels: [],
      })
    }
  }

  /**
   * 2. Include ready state of document in all other repos (peers)
   */
  for (const peer of model.peers.values()) {
    const awareness = peer.docSyncStates.get(docId)

    if (!awareness || awareness.status === "unknown") {
      continue
    }

    if (awareness.status === "synced" || awareness.status === "pending") {
      const channels: ReadyStateChannelMeta[] = []

      for (const channelId of peer.channels) {
        const channel = model.channels.get(channelId)
        if (!channel) continue

        channels.push({
          kind: channel.kind,
          state: channel.type,
          adapterType: channel.adapterType,
        })
      }

      // "synced" means we know their version (loaded)
      // "pending" means they have it but we don't know their version yet (aware)
      const status = awareness.status === "pending" ? "pending" : "synced"
      readyStates.push({
        status,
        docId,
        identity: { ...peer.identity },
        channels,
      })
    } else if (awareness.status === "absent") {
      // Build channels list for absent state too
      const channels: ReadyStateChannelMeta[] = []
      for (const channelId of peer.channels) {
        const channel = model.channels.get(channelId)
        if (!channel) continue

        channels.push({
          kind: channel.kind,
          state: channel.type,
          adapterType: channel.adapterType,
        })
      }

      readyStates.push({
        status: "absent",
        docId,
        identity: { ...peer.identity },
        channels,
      })
    } else {
      throw new Error("invalid awareness state")
    }
  }

  return readyStates
}
