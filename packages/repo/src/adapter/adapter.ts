import { getLogger, type Logger } from "@logtape/logtape"
import type {
  AddressedEnvelope,
  BaseChannel,
  Channel,
  ChannelId,
} from "../channel.js"
import { ChannelDirectory } from "../channel-directory.js"
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

  abstract onBeforeStart({
    addChannel,
    removeChannel,
  }: {
    addChannel: (context: G) => Channel
    removeChannel: (channelId: ChannelId) => Channel | undefined
  }): void

  abstract onStart(): void

  abstract onAfterStop(): void

  _prepare({
    channelAdded,
    channelRemoved,
  }: {
    channelAdded: (channel: Channel) => void
    channelRemoved: (channel: Channel) => void
  }) {
    this.logger.trace(`prepare`)

    this.channels.setHooks({
      channelAdded,
      channelRemoved,
    })

    const addChannel = (context: G) => {
      return this.channels.create(context)
    }

    const removeChannel = (channelId: ChannelId) => {
      return this.channels.remove(channelId)
    }

    return this.onBeforeStart({ addChannel, removeChannel })
  }

  _stop() {
    this.logger.trace(`stop`)
    this.channels.reset()
    this.onAfterStop()
  }

  _send(envelope: AddressedEnvelope): boolean {
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
