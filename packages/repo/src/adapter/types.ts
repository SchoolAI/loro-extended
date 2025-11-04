import type { Channel, ChannelMsg } from "../channel.js"
import type { AdapterId, ChannelId, PeerID } from "../types.js"

export type HandleSendFn = (
  adapterId: AdapterId,
  toChannelId: ChannelId,
  message: ChannelMsg,
) => void
