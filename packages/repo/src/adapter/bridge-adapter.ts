import { getLogger, type Logger } from "@logtape/logtape"
import type { ChannelMsg, GeneratedChannel } from "../channel.js"
import type { AdapterType, ChannelId } from "../types.js"
import { Adapter } from "./adapter.js"

type BridgeParams = {
  logger?: Logger
}

/**
 * A simple message router that connects multiple BridgeAdapters within the same process.
 * This enables direct message passing between adapters for testing purposes.
 */
export class Bridge {
  readonly adapters = new Map<AdapterType, BridgeAdapter>()
  readonly logger: Logger

  constructor({ logger }: BridgeParams = {}) {
    this.logger = logger ?? getLogger(["@loro-extended", "repo"])
  }

  /**
   * Register an adapter with this bridge
   */
  addAdapter(adapter: BridgeAdapter): void {
    if (!adapter.adapterType)
      throw new Error("can't add adapter without adapter id")

    this.adapters.set(adapter.adapterType, adapter)
  }

  /**
   * Remove an adapter from this bridge
   */
  removeAdapter(adapterType: AdapterType): void {
    this.adapters.delete(adapterType)
  }

  /**
   * Route a message from one adapter to another
   */
  routeMessage(
    fromAdapterType: AdapterType,
    toAdapterType: AdapterType,
    message: ChannelMsg,
  ): void {
    this.logger.trace("routeMessage: {messageType} from {from} to {to}", {
      from: fromAdapterType,
      to: toAdapterType,
      messageType: message.type,
    })
    const toAdapter = this.adapters.get(toAdapterType)
    if (toAdapter) {
      toAdapter.deliverMessage(fromAdapterType, message)
    } else {
      this.logger.warn(
        "routeMessage: target adapter {toAdapterType} not found",
        { toAdapterType },
      )
    }
  }

  /**
   * Get all adapter IDs currently in the bridge
   */
  get adapterTypes(): Set<AdapterType> {
    return new Set(this.adapters.keys())
  }
}

type BridgeAdapterContext = {
  targetAdapterType: AdapterType
}

type BridgeAdapterParams = {
  adapterType: AdapterType
  /**
   * Unique identifier for this adapter instance.
   * If not provided, defaults to adapterType for backwards compatibility.
   */
  adapterId?: string
  bridge: Bridge
  logger?: Logger
}

export class BridgeAdapter extends Adapter<BridgeAdapterContext> {
  readonly bridge: Bridge
  readonly logger: Logger

  // Track which remote adapter each channel connects to
  private channelToAdapter = new Map<ChannelId, AdapterType>()
  private adapterToChannel = new Map<AdapterType, ChannelId>()

  constructor({ adapterType, adapterId, bridge, logger }: BridgeAdapterParams) {
    // Default adapterId to adapterType for backwards compatibility
    super({ adapterType, adapterId: adapterId ?? adapterType })
    this.bridge = bridge
    this.logger = (logger ?? getLogger(["@loro-extended", "repo"])).with({
      adapterType,
    })

    this.logger.trace(`new BridgeAdapter`)
  }

  generate(context: BridgeAdapterContext): GeneratedChannel {
    this.logger.debug("generate channel to {targetAdapterType}", {
      targetAdapterType: context.targetAdapterType,
    })

    return {
      adapterType: this.adapterType,
      kind: "network",
      send: msg => {
        this.logger.debug("channel.send: {messageType} from {from} to {to}", {
          from: this.adapterType,
          to: context.targetAdapterType,
          messageType: msg.type,
        })
        // Route message through bridge to target adapter
        this.bridge.routeMessage(
          this.adapterType,
          context.targetAdapterType,
          msg,
        )
      },
      stop: () => {
        // Cleanup handled by removeChannel
      },
    }
  }

  /**
   * Start participating in the in-process network.
   * Uses two-phase initialization:
   * 1. Create all channels (no messages sent)
   * 2. Establish channels (only the "newer" adapter initiates to avoid double-establishment)
   */
  async onStart(): Promise<void> {
    this.logger.trace(`onStart - registering with bridge`)

    // Step 1: Register with bridge
    this.bridge.addAdapter(this)

    // Phase 1: Create all channels (no establishment yet)
    // Tell existing adapters to create channels to us
    for (const [adapterType, adapter] of this.bridge.adapters) {
      if (adapterType !== this.adapterType) {
        this.logger.trace("telling {adapterType} to create channel to us", {
          adapterType,
        })
        adapter.createChannelTo(this.adapterType)
      }
    }

    // Create our channels to existing adapters
    for (const adapterType of this.bridge.adapters.keys()) {
      if (adapterType !== this.adapterType) {
        this.logger.trace("creating our channel to {adapterType}", {
          adapterType,
        })
        this.createChannelTo(adapterType)
      }
    }

    // Phase 2: Establish channels
    // Only WE initiate establishment (to existing adapters)
    // This avoids double-establishment since we're the "new" adapter joining
    for (const channelId of this.adapterToChannel.values()) {
      this.logger.trace("establishing our channel {channelId}", { channelId })
      this.establishChannel(channelId)
    }

    this.logger.trace(`onStart complete`)
  }

  /**
   * Stop participating in the in-process network.
   * Cleans up all channels and removes from bridge.
   */
  async onStop(): Promise<void> {
    this.logger.trace(`stop`)

    // Tell other adapters to remove their channels to us
    for (const [adapterType, adapter] of this.bridge.adapters) {
      if (adapterType !== this.adapterType) {
        adapter.removeChannelTo(this.adapterType)
      }
    }

    // Remove ourselves from bridge
    this.bridge.removeAdapter(this.adapterType)

    // Remove all our channels
    for (const channelId of this.channelToAdapter.keys()) {
      this.removeChannel(channelId)
    }
    this.channelToAdapter.clear()
    this.adapterToChannel.clear()
  }

  /**
   * Create a channel to a target adapter (Phase 1).
   * Does NOT trigger establishment - that happens in Phase 2.
   * Called by our own onStart() or by other adapters when they start.
   */
  createChannelTo(targetAdapterType: AdapterType): void {
    if (this.adapterToChannel.has(targetAdapterType)) {
      this.logger.trace("channel already exists to {targetAdapterType}", {
        targetAdapterType,
      })
      return
    }

    const channel = this.addChannel({ targetAdapterType: targetAdapterType })
    this.channelToAdapter.set(channel.channelId, targetAdapterType)
    this.adapterToChannel.set(targetAdapterType, channel.channelId)

    this.logger.trace(
      "channel {channelId} created (not yet established) to {targetAdapterType}",
      {
        targetAdapterType,
        channelId: channel.channelId,
      },
    )
  }

  /**
   * Establish a channel to a target adapter (Phase 2).
   * Triggers the establishment handshake.
   * Called by our own onStart() or by other adapters when they start.
   */
  establishChannelTo(targetAdapterType: AdapterType): void {
    const channelId = this.adapterToChannel.get(targetAdapterType)
    if (!channelId) {
      this.logger.warn("no channel found to establish to {targetAdapterType}", {
        targetAdapterType,
      })
      return
    }

    this.logger.trace("establishing channel {channelId}", { channelId })
    this.establishChannel(channelId)
  }

  /**
   * Remove a channel to a target adapter.
   * Called by other adapters when they stop.
   */
  removeChannelTo(targetAdapterType: AdapterType): void {
    const channelId = this.adapterToChannel.get(targetAdapterType)
    if (channelId) {
      this.logger.trace("removing channel to adapter {targetAdapterType}", {
        targetAdapterType,
      })
      this.removeChannel(channelId)
      this.channelToAdapter.delete(channelId)
      this.adapterToChannel.delete(targetAdapterType)
    }
  }

  /**
   * Deliver a message from another adapter to the appropriate channel.
   * Called by Bridge.routeMessage().
   *
   * Delivers messages synchronously. The Synchronizer's receive queue handles
   * recursion prevention by queuing messages and processing them iteratively.
   */
  deliverMessage(fromAdapterType: AdapterType, message: ChannelMsg): void {
    const channelId = this.adapterToChannel.get(fromAdapterType)
    if (channelId) {
      const channel = this.channels.get(channelId)
      if (channel) {
        this.logger.trace(
          "delivering message {messageType} to channel {channelId} from {from}",
          {
            from: fromAdapterType,
            messageType: message.type,
            channelId,
          },
        )
        // Deliver synchronously - the Synchronizer's receive queue prevents recursion
        channel.onReceive(message)
      } else {
        this.logger.warn(
          "channel {channelId} not found for message delivery from {fromAdapterType}",
          {
            fromAdapterType,
            channelId,
          },
        )
      }
    } else {
      this.logger.warn("no channel found for adapter {fromAdapterType}", {
        fromAdapterType,
        availableChannels: Array.from(this.adapterToChannel.keys()),
      })
    }
  }
}
