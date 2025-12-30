import type { Logger } from "@logtape/logtape"
import type { Channel, ChannelId, EstablishedChannel } from "../channel.js"
import type { Permissions } from "../permissions.js"
import type { SynchronizerModel } from "../synchronizer-program.js"
import type { PeerState } from "../types.js"

/**
 * Context passed to channel message handlers that work with any channel state.
 * Used by establish-request/response handlers.
 */
export type ChannelHandlerContext = {
  channel: Channel
  model: SynchronizerModel
  fromChannelId: ChannelId
  permissions: Permissions
  logger: Logger
}

/**
 * Context passed to handlers that require an established channel.
 * The channel is guaranteed to be established and peerState is guaranteed to exist.
 * Used by all handlers except establish-request/response.
 *
 * This type enforces at compile-time that handlers receiving this context
 * don't need to perform runtime checks for channel establishment or peer state.
 */
export type EstablishedHandlerContext = {
  channel: EstablishedChannel
  peerState: PeerState
  model: SynchronizerModel
  fromChannelId: ChannelId
  permissions: Permissions
  logger: Logger
}
