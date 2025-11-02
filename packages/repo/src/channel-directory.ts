import { v4 as uuid } from "uuid"
import type { Channel, ChannelId, GenerateFn } from "./channel.js"

let channelIssuanceId = 1

export class ChannelDirectory<G> {
  private readonly channels: Map<ChannelId, Channel> = new Map()

  private channelAdded?: (channel: Channel) => void
  private channelRemoved?: (channel: Channel) => void

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

  setHooks(hooks: {
    channelAdded: (channel: Channel) => void
    channelRemoved: (channel: Channel) => void
  }) {
    this.channelAdded = hooks.channelAdded
    this.channelRemoved = hooks.channelRemoved
  }

  create(context: G): Channel {
    const channelId = channelIssuanceId++

    const channel: Channel = Object.assign(this.generate(context), {
      channelId,
      publishDocId: uuid(),
      peer: {
        state: "unestablished",
      },
    } as const)

    this.channels.set(channelId, channel)

    this.channelAdded?.(channel)

    return channel
  }

  remove(channelId: ChannelId): Channel | undefined {
    const channel = this.channels.get(channelId)

    if (!channel) {
      return
    }

    this.channels.delete(channelId)

    this.channelRemoved?.(channel)

    return channel
  }

  reset() {
    for (const channelId of this.channels.keys()) {
      this.remove(channelId)
    }
  }
}
