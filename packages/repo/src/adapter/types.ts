import type { ChannelMsg } from "../channel.js"
import type { AdapterId, ChannelId } from "../types.js"

export type HandleSendFn = (
  adapterId: AdapterId,
  toChannelId: ChannelId,
  message: ChannelMsg,
) => void
