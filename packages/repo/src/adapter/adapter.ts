import { getLogger, type Logger } from "@logtape/logtape"
import type {
  AddressedEnvelope,
  BaseChannel,
  Channel,
  ChannelId,
} from "../channel.js"
import { ChannelDirectory } from "../channel.js"
import type { AdapterId } from "../types.js"
import type { HandleSendFn } from "./types.js"

// biome-ignore lint/suspicious/noExplicitAny: Flexible type for heterogeneous adapter arrays
export type AnyAdapter = Adapter<any>

type AdapterParams = {
  adapterId: AdapterId
  logger?: Logger
}

export abstract class Adapter<G> {
  readonly adapterId: AdapterId
  readonly logger: Logger
  readonly channels: ChannelDirectory<G>

  // Used for debugging; set by AdapterManager
  onSend: HandleSendFn | undefined

  constructor({ adapterId, logger }: AdapterParams) {
    this.adapterId = adapterId
    this.logger = logger ?? getLogger(["@loro-extended", "repo"])
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
    this.logger.trace(`prepare`)

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
    this.logger.trace(`stop`)
    this.channels.reset()
    this.deinit()
  }

  send(envelope: AddressedEnvelope): boolean {
    let foundAddressee = false

    for (const toChannelId of envelope.toChannelIds) {
      const channel = this.channels.get(toChannelId)
      if (channel) {
        this.onSend?.(this.adapterId, toChannelId, envelope.message)
        channel.send(envelope.message)
        foundAddressee = true
      }
    }

    return foundAddressee
  }
}
