import type { ChannelMsgEphemeral } from "../channel.js"
import type { Command } from "../synchronizer-program.js"
import { getEstablishedChannelsForDoc } from "../utils/get-established-channels-for-doc.js"
import type { ChannelHandlerContext } from "./types.js"

export function handleEphemeral(
  message: ChannelMsgEphemeral,
  { model }: ChannelHandlerContext,
): Command | undefined {
  const commands: Command[] = []

  if (message.hopsRemaining > 0) {
    const toChannelIds = getEstablishedChannelsForDoc(
      model.channels,
      model.peers,
      message.docId,
    )

    commands.push({
      type: "cmd/broadcast-ephemeral",
      docId: message.docId,
      allPeerData: false,
      hopsRemaining: message.hopsRemaining - 1,
      toChannelIds,
    })
  }

  return {
    type: "cmd/apply-ephemeral",
    docId: message.docId,
    data: message.data,
  }
}
