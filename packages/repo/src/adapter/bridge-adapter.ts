import Emittery, { type UnsubscribeFunction } from "emittery"
import type { BaseChannel, Channel, ChannelMsg } from "../channel.js"
import type { AdapterId, ChannelId } from "../types.js"
import { Adapter } from "./adapter.js"

interface BridgeEvents {
  // announce an adapter has joined the bridge
  "adapter-added": { adapterId: AdapterId }

  // announce an adapter has been removed from the bridge
  "adapter-removed": { adapterId: AdapterId }

  // send or receive a message
  "send-message": { adapterId: AdapterId; message: ChannelMsg }
}

/**
 * A bridge that connects multiple InProcessNetworkAdapters within the same process.
 * This enables direct message passing between adapters for testing purposes.
 */
export class Bridge extends Emittery<BridgeEvents> {
  readonly #adapters = new Map<AdapterId, BridgeAdapter>()

  /**
   * Register an adapter with this bridge
   */
  addAdapter(adapter: BridgeAdapter): void {
    if (!adapter.adapterId)
      throw new Error("can't add adapter without adapter id")

    this.#adapters.set(adapter.adapterId, adapter)
  }

  /**
   * Remove an adapter from this bridge
   */
  removeAdapter(adapterId: AdapterId): void {
    this.#adapters.delete(adapterId)
  }

  /**
   * Send a message to a bridged adapter
   */
  send(adapterId: AdapterId, message: ChannelMsg) {
    this.emit("send-message", { adapterId, message })
  }

  /**
   * Subscribe to messages from a bridged adapter
   */
  subscribe(adapterId: AdapterId, callback: (message: ChannelMsg) => void) {
    return this.on("send-message", ({ adapterId: toAdapterId, message }) => {
      if (adapterId === toAdapterId) {
        callback(message)
      }
    })
  }

  /**
   * Broadcast that an adapter has been added to the network
   */
  announceAdapterAdded(adapterId: AdapterId): void {
    this.emit("adapter-added", { adapterId })
  }

  /**
   * Broadcast that an adapter has been removed from the network
   */
  announceAdapterRemoved(adapterId: AdapterId): void {
    this.emit("adapter-removed", { adapterId })
  }

  /**
   * Get all adapter IDs currently in the bridge network
   */
  get adapterIds(): Set<AdapterId> {
    return new Set(this.#adapters.keys())
  }
}

type InlineContext = {
  send: (msg: ChannelMsg) => void
  subscribe: (fn: (msg: ChannelMsg) => void) => UnsubscribeFunction
}

export class BridgeAdapter extends Adapter<InlineContext> {
  readonly #bridge: Bridge
  #deinit: (() => void) | undefined
  #unsubscribes: (() => void)[] = []
  #adapterLookup: Map<AdapterId, ChannelId> = new Map()

  constructor(bridge: Bridge, adapterId: AdapterId = "inline") {
    super(adapterId)
    this.#bridge = bridge
  }

  generate(context: InlineContext): BaseChannel {
    let started = false
    let unsub: UnsubscribeFunction | null = null

    return {
      adapterId: this.adapterId,
      kind: "network",
      send: msg => {
        if (started) {
          context.send(msg)
        } else {
          throw new Error(`adapter can't send message when stopped`)
        }
      },
      start: receive => {
        started = true
        unsub = context.subscribe(msg => {
          if (started) {
            receive(msg)
          } else {
            throw new Error(`adapter can't receive message when stopped`)
          }
        })
      },
      stop: () => {
        started = false
        unsub?.()
        unsub = null
      },
    }
  }

  /**
   * Start participating in the in-process network.
   * Registers this adapter with the bridge and begins listening for network events.
   */
  init({
    addChannel,
    removeChannel,
  }: {
    addChannel: (context: InlineContext) => Channel
    removeChannel: (id: ChannelId) => Channel | undefined
  }) {
    this.#bridge.addAdapter(this)

    // Listen for network events
    this.#unsubscribes.push(
      this.#bridge.on("adapter-added", ({ adapterId }) => {
        // When an adapter is added to the bridge, we create a channel between ourselves and that adapter
        const channel = addChannel({
          send: (message: ChannelMsg) => {
            // 1. Find the one and only channelId that corresponds to this adapterId
            const channelId = this.#adapterLookup.get(adapterId)

            if (!channelId) {
              throw new Error(
                `can't get channelId to send (adapter: ${adapterId})`,
              )
            }

            // 2. Send!
            this.#bridge.send(adapterId, message)
          },

          subscribe: (fn: (msg: ChannelMsg) => void) => {
            return this.#bridge.subscribe(adapterId, fn)
          },
        })

        this.#adapterLookup.set(adapterId, channel.channelId)
      }),
    )

    this.#unsubscribes.push(
      this.#bridge.on("adapter-removed", ({ adapterId }) => {
        const channelId = this.#adapterLookup.get(adapterId)

        if (!channelId) {
          throw new Error(`channel ID for adapter not found ${adapterId}`)
        }

        removeChannel(channelId)
      }),
    )

    // De-init
    this.#deinit = () => {
      // Remove all bridge event listeners
      for (const unsub of this.#unsubscribes) {
        unsub()
      }

      this.#unsubscribes = []
    }
  }

  start() {
    this.#bridge.announceAdapterAdded(this.adapterId)
  }

  deinit() {
    this.#deinit?.()
  }
}
