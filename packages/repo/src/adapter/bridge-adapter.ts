import { getLogger, type Logger } from "@logtape/logtape"
import type { ChannelMsg, GeneratedChannel } from "../channel.js"
import type { AdapterId, ChannelId } from "../types.js"
import { Adapter } from "./adapter.js"

type BridgeParams = {
  logger?: Logger
}

/**
 * A simple message router that connects multiple BridgeAdapters within the same process.
 * This enables direct message passing between adapters for testing purposes.
 */
export class Bridge {
  readonly adapters = new Map<AdapterId, BridgeAdapter>()
  readonly logger: Logger

  constructor({ logger }: BridgeParams = {}) {
    this.logger = logger ?? getLogger(["@loro-extended", "repo"])
  }

  /**
   * Register an adapter with this bridge
   */
  addAdapter(adapter: BridgeAdapter): void {
    if (!adapter.adapterId)
      throw new Error("can't add adapter without adapter id")

    this.adapters.set(adapter.adapterId, adapter)
  }

  /**
   * Remove an adapter from this bridge
   */
  removeAdapter(adapterId: AdapterId): void {
    this.adapters.delete(adapterId)
  }

  /**
   * Route a message from one adapter to another
   */
  routeMessage(
    fromAdapterId: AdapterId,
    toAdapterId: AdapterId,
    message: ChannelMsg,
  ): void {
    this.logger.trace(`routeMessage`, {
      from: fromAdapterId,
      to: toAdapterId,
      messageType: message.type,
    })
    const toAdapter = this.adapters.get(toAdapterId)
    if (toAdapter) {
      toAdapter.deliverMessage(fromAdapterId, message)
    } else {
      this.logger.warn(`routeMessage: target adapter not found`, {
        toAdapterId,
      })
    }
  }

  /**
   * Get all adapter IDs currently in the bridge
   */
  get adapterIds(): Set<AdapterId> {
    return new Set(this.adapters.keys())
  }
}

type BridgeAdapterContext = {
  targetAdapterId: AdapterId
}

type BridgeAdapterParams = {
  adapterId: AdapterId
  bridge: Bridge
  logger?: Logger
}

export class BridgeAdapter extends Adapter<BridgeAdapterContext> {
  readonly bridge: Bridge
  readonly logger: Logger

  // Track which remote adapter each channel connects to
  private channelToAdapter = new Map<ChannelId, AdapterId>()
  private adapterToChannel = new Map<AdapterId, ChannelId>()

  constructor({ adapterId, bridge, logger }: BridgeAdapterParams) {
    super({ adapterId })
    this.bridge = bridge
    this.logger = (logger ?? getLogger(["@loro-extended", "repo"])).with({
      adapterId,
    })

    this.logger.trace(`new BridgeAdapter`)
  }

  generate(context: BridgeAdapterContext): GeneratedChannel {
    this.logger.debug(`generate`, { targetAdapterId: context.targetAdapterId })

    return {
      adapterId: this.adapterId,
      kind: "network",
      send: msg => {
        this.logger.debug(`channel.send`, {
          from: this.adapterId,
          to: context.targetAdapterId,
          messageType: msg.type,
        })
        // Route message through bridge to target adapter
        this.bridge.routeMessage(this.adapterId, context.targetAdapterId, msg)
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
    for (const [adapterId, adapter] of this.bridge.adapters) {
      if (adapterId !== this.adapterId) {
        this.logger.trace(`telling ${adapterId} to create channel to us`)
        adapter.createChannelTo(this.adapterId)
      }
    }

    // Create our channels to existing adapters
    for (const adapterId of this.bridge.adapters.keys()) {
      if (adapterId !== this.adapterId) {
        this.logger.trace(`creating our channel to ${adapterId}`)
        this.createChannelTo(adapterId)
      }
    }

    // Phase 2: Establish channels
    // Only WE initiate establishment (to existing adapters)
    // This avoids double-establishment since we're the "new" adapter joining
    for (const channelId of this.adapterToChannel.values()) {
      this.logger.trace(`establishing our channel ${channelId}`)
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
    for (const [adapterId, adapter] of this.bridge.adapters) {
      if (adapterId !== this.adapterId) {
        adapter.removeChannelTo(this.adapterId)
      }
    }

    // Remove ourselves from bridge
    this.bridge.removeAdapter(this.adapterId)

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
  createChannelTo(targetAdapterId: AdapterId): void {
    if (this.adapterToChannel.has(targetAdapterId)) {
      this.logger.trace(`channel already exists to ${targetAdapterId}`)
      return
    }

    const channel = this.addChannel({ targetAdapterId })
    this.channelToAdapter.set(channel.channelId, targetAdapterId)
    this.adapterToChannel.set(targetAdapterId, channel.channelId)

    this.logger.trace(`channel created (not yet established)`, {
      targetAdapterId,
      channelId: channel.channelId,
    })
  }

  /**
   * Establish a channel to a target adapter (Phase 2).
   * Triggers the establishment handshake.
   * Called by our own onStart() or by other adapters when they start.
   */
  establishChannelTo(targetAdapterId: AdapterId): void {
    const channelId = this.adapterToChannel.get(targetAdapterId)
    if (!channelId) {
      this.logger.warn(`no channel found to establish`, { targetAdapterId })
      return
    }

    this.logger.trace(`establishing channel ${channelId}`)
    this.establishChannel(channelId)
  }

  /**
   * Remove a channel to a target adapter.
   * Called by other adapters when they stop.
   */
  removeChannelTo(targetAdapterId: AdapterId): void {
    const channelId = this.adapterToChannel.get(targetAdapterId)
    if (channelId) {
      this.logger.trace(`removing channel to adapter`, { targetAdapterId })
      this.removeChannel(channelId)
      this.channelToAdapter.delete(channelId)
      this.adapterToChannel.delete(targetAdapterId)
    }
  }

  /**
   * Deliver a message from another adapter to the appropriate channel.
   * Called by Bridge.routeMessage().
   */
  deliverMessage(fromAdapterId: AdapterId, message: ChannelMsg): void {
    const channelId = this.adapterToChannel.get(fromAdapterId)
    if (channelId) {
      const channel = this.channels.get(channelId)
      if (channel) {
        this.logger.trace(`delivering message to channel ${channelId}`, {
          from: fromAdapterId,
          messageType: message.type,
        })
        // Deliver to the channel's onReceive callback (set by synchronizer)
        channel.onReceive(message)
      } else {
        this.logger.warn(`channel not found for message delivery`, {
          fromAdapterId,
          channelId,
        })
      }
    } else {
      this.logger.warn(`no channel found for adapter`, {
        fromAdapterId,
        availableChannels: Array.from(this.adapterToChannel.keys()),
      })
    }
  }
}
