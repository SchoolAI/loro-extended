import type { ChannelMsg } from "../channel.js"
import type { AdapterType, ChannelId } from "../types.js"

export type HandleSendFn = (
  adapterType: AdapterType,
  toChannelId: ChannelId,
  message: ChannelMsg,
) => void
