import type { ChannelMsgEphemeral } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { getEstablishedChannelsForDoc } from "../../utils/get-established-channels-for-doc.js"
import type { ChannelHandlerContext } from "../types.js"
import { batchAsNeeded } from "../utils.js"

export function handleEphemeral(
  message: ChannelMsgEphemeral,
  { model, fromChannelId }: ChannelHandlerContext,
): Command | undefined {
  // First, apply the ephemeral data locally
  const applyCommand: Command = {
    type: "cmd/apply-ephemeral",
    docId: message.docId,
    data: message.data,
  }

  // If hops remaining, relay the SAME data to other peers (hub-and-spoke relay)
  // This is critical: we forward the original message data, not re-encode our own data
  if (message.hopsRemaining > 0) {
    // Get all established channels for this document, excluding the sender
    const allChannelIds = getEstablishedChannelsForDoc(
      model.channels,
      model.peers,
      message.docId,
    )

    // Filter out the channel that sent us this message to avoid echo
    const toChannelIds = allChannelIds.filter(id => id !== fromChannelId)

    if (toChannelIds.length > 0) {
      // Use cmd/send-message to forward the original data unchanged
      const relayCommand: Command = {
        type: "cmd/send-message",
        envelope: {
          toChannelIds,
          message: {
            type: "channel/ephemeral",
            docId: message.docId,
            hopsRemaining: message.hopsRemaining - 1,
            data: message.data, // Forward the original data, not re-encoded
          },
        },
      }

      return batchAsNeeded(applyCommand, relayCommand)
    }
  }

  return applyCommand
}
