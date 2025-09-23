import type {
  AddressedEnvelope,
  BaseChannel,
  Channel,
  ChannelId,
} from "../channel.js"
import { ChannelDirectory } from "../channel.js"
import type { AdapterId } from "../types.js"

export type AnyAdapter = Adapter<unknown>

export abstract class Adapter<G> {
  channels: ChannelDirectory<G>

  constructor(readonly adapterId: AdapterId) {
    this.channels = new ChannelDirectory(this.generate.bind(this))
  }

  protected abstract generate(context: G): BaseChannel

  abstract init({
    addChannel,
    removeChannel,
  }: {
    addChannel: (context: G) => Channel
    removeChannel: (channelId: ChannelId) => Channel | undefined
  }): void

  abstract deinit(): void

  abstract start(): void

  prepare({
    channelAdded,
    channelRemoved,
  }: {
    channelAdded: (channel: Channel) => void
    channelRemoved: (channel: Channel) => void
  }) {
    return this.init({
      addChannel: (context: G) => {
        const channel = this.channels.create(context)

        channelAdded(channel)

        return channel
      },
      removeChannel: (channelId: ChannelId) => {
        const channel = this.channels.remove(channelId)

        if (channel) {
          channelRemoved(channel)
        }

        return channel
      },
    })
  }

  stop() {
    this.channels.reset()
    this.deinit()
  }

  send(envelope: AddressedEnvelope) {
    for (const toChannelId of envelope.toChannelIds) {
      const channel = this.channels.get(toChannelId)
      if (channel) {
        channel.send(envelope.message)
      }
    }
  }
}
