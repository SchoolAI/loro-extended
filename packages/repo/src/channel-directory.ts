import type {
  Channel,
  ChannelId,
  ConnectedChannel,
  GenerateFn,
  ReceiveFn,
} from "./channel.js"

let channelIssuanceId = 1

export type ChannelDirectoryHooks = {
  onChannelAdded: (channel: Channel) => void
  onChannelRemoved: (channel: Channel) => void
}

export class ChannelDirectory<G> {
  private readonly channels: Map<ChannelId, Channel> = new Map()

  private onChannelAdded?: (channel: Channel) => void
  private onChannelRemoved?: (channel: Channel) => void

  constructor(readonly generate: GenerateFn<G>) {}

  *[Symbol.iterator](): IterableIterator<Channel> {
    yield* this.channels.values()
  }

  has(channelId: ChannelId): boolean {
    return this.channels.has(channelId)
  }

  get(channelId: ChannelId): Channel | undefined {
    return this.channels.get(channelId)
  }

  get size(): number {
    return this.channels.size
  }

  setHooks(hooks: ChannelDirectoryHooks) {
    this.onChannelAdded = hooks.onChannelAdded
    this.onChannelRemoved = hooks.onChannelRemoved
  }

  /**
   * Using an adapter's `generate` function, create a GeneratedChannel and then fill in
   * details needed to convert it to a ConnectedChannel.
   *
   * @param context The context specific to the Adapter type
   * @param onReceive A callback to be used to forward messages to the synchronizer
   * @returns a ConnectedChannel capable of sending EstablishmentMsgs
   */
  create(context: G, onReceive: ReceiveFn): ConnectedChannel {
    const channelId = channelIssuanceId++

    const generatedChannel = this.generate(context)

    const channel: Channel = {
      // NOTE:
      //   The 'send' function becomes type-narrowed here so that only messages related
      //   to establishing the peer identity can be sent through the 'connected' channel.
      //   Runtime-wise, however, the `send` function is identical, which is why we can
      //   pass it through with a spread.
      ...generatedChannel,
      type: "connected",
      channelId,
      onReceive,
    }

    this.channels.set(channelId, channel)

    this.onChannelAdded?.(channel)

    return channel
  }

  remove(channelId: ChannelId): Channel | undefined {
    const channel = this.channels.get(channelId)

    if (!channel) {
      return
    }

    this.channels.delete(channelId)

    this.onChannelRemoved?.(channel)

    return channel
  }

  reset() {
    for (const channelId of this.channels.keys()) {
      this.remove(channelId)
    }
  }
}
