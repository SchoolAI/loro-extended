import type { Logger } from "@logtape/logtape"
import type { Channel, ChannelId } from "../channel.js"
import type { Rules } from "../rules.js"
import type { SynchronizerModel } from "../synchronizer-program.js"

/**
 * Context passed to all channel message handlers
 */
export type ChannelHandlerContext = {
  channel: Channel
  model: SynchronizerModel
  fromChannelId: ChannelId
  permissions: Rules
  logger: Logger
}
