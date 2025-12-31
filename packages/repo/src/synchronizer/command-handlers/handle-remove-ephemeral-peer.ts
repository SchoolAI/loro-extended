import type { ChannelMsgEphemeral } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { getEstablishedChannelsForDoc } from "../../utils/get-established-channels-for-doc.js"
import type { CommandContext } from "../command-executor.js"

type RemoveEphemeralPeerCommand = Extract<
  Command,
  { type: "cmd/remove-ephemeral-peer" }
>

/**
 * Handle the cmd/remove-ephemeral-peer command.
 *
 * Removes a peer's data from all documents' namespaced stores and broadcasts
 * the deletion to other peers.
 */
export function handleRemoveEphemeralPeer(
  command: RemoveEphemeralPeerCommand,
  ctx: CommandContext,
): void {
  const { peerId } = command

  // Remove the peer's data from all documents' namespaced stores
  for (const [docId, namespaceStores] of ctx.docNamespacedStores) {
    let peerDataRemoved = false
    const storesToBroadcast: { namespace: string }[] = []

    // Check ALL namespaces for this peer's data
    for (const [namespace, store] of namespaceStores) {
      const allStates = store.getAllStates()
      if (allStates[peerId] !== undefined) {
        // Delete the peer's key from this store
        store.delete(peerId)
        peerDataRemoved = true
        storesToBroadcast.push({ namespace })
      }
    }

    if (peerDataRemoved) {
      // Broadcast deletion to other peers using the utility function
      const channelIds = getEstablishedChannelsForDoc(
        ctx.model.channels,
        ctx.model.peers,
        docId,
      )

      if (channelIds.length > 0 && storesToBroadcast.length > 0) {
        // Build the ephemeral deletion message
        const ephemeralMessage: ChannelMsgEphemeral = {
          type: "channel/ephemeral",
          docId,
          hopsRemaining: 0,
          stores: storesToBroadcast.map(s => ({
            peerId,
            data: new Uint8Array(0), // Empty data signals deletion
            namespace: s.namespace,
          })),
        }

        // Queue for each channel (deferred send will aggregate)
        for (const channelId of channelIds) {
          ctx.queueSend(channelId, ephemeralMessage)
        }
      }

      // Emit change event so UI updates immediately
      // This is "remote" because we're removing a remote peer's data
      ctx.emitter.emit("ephemeral-change", {
        docId,
        source: "remote",
        peerId,
      })
    }
  }
}
