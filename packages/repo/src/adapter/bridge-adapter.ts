import { getLogger, type Logger } from "@logtape/logtape"
import Emittery, { type UnsubscribeFunction } from "emittery"
import type { BaseChannel, Channel, ChannelMsg } from "../channel.js"
import type { AdapterId, ChannelId } from "../types.js"
import { Adapter } from "./adapter.js"

interface BridgeEvents {
  // announce an adapter has joined the bridge (buffered)
  "adapter-added": { adapterId: AdapterId }

  // announce an adapter has been removed from the bridge (buffered)
  "adapter-removed": { adapterId: AdapterId }

  // send or receive a message (unbuffered)
  "send-message": { adapterId: AdapterId; message: ChannelMsg }
}

type BufferedEvent = {
  event: "adapter-added" | "adapter-removed"
  data: { adapterId: AdapterId }
}

type BridgeParams = {
  logger?: Logger
}

/**
 * A bridge that connects multiple BridgeAdapters within the same process.
 * This enables direct message passing between adapters for testing purposes.
 *
 * Uses message buffering to ensure new adapters learn about existing adapters,
 * solving the race condition where adapters start at different times.
 */
export class Bridge {
  readonly emitter = new Emittery<BridgeEvents>()
  readonly adapters = new Map<AdapterId, BridgeAdapter>()
  readonly eventHistory: BufferedEvent[] = []
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
   * Send a message to a bridged adapter
   */
  send(adapterId: AdapterId, message: ChannelMsg) {
    this.emitter.emit("send-message", { adapterId, message })
  }

  /**
   * Subscribe to messages from a bridged adapter
   */
  subscribe(adapterId: AdapterId, callback: (message: ChannelMsg) => void) {
    return this.emitter.on(
      "send-message",
      ({ adapterId: toAdapterId, message }) => {
        if (adapterId === toAdapterId) {
          callback(message)
        }
      },
    )
  }

  /**
   * Subscribe to bridge events with automatic replay of buffered events.
   * This ensures new listeners receive historical adapter-added/removed events.
   */
  on<E extends keyof BridgeEvents>(
    event: E,
    handler: (data: BridgeEvents[E]) => void | Promise<void>,
  ): UnsubscribeFunction {
    // Replay buffered events for this event type
    if (event === "adapter-added" || event === "adapter-removed") {
      for (const bufferedEvent of this.eventHistory) {
        if (bufferedEvent.event === event) {
          handler(bufferedEvent.data as BridgeEvents[E])
        }
      }
    }

    // Subscribe to future events
    return this.emitter.on(event, handler)
  }

  /**
   * Broadcast that an adapter has been added to the network
   */
  announceAdapterAdded(adapterId: AdapterId): void {
    const data = { adapterId }

    this.logger.debug(`announceAdapterAdded`, {
      adapterId,
      eventHistory: this.eventHistory,
    })

    // Buffer the event
    this.eventHistory.push({ event: "adapter-added", data })

    // Emit to current listeners
    this.emitter.emit("adapter-added", data)
  }

  /**
   * Broadcast that an adapter has been removed from the network
   */
  announceAdapterRemoved(adapterId: AdapterId): void {
    const data = { adapterId }

    // Buffer the removal event
    this.eventHistory.push({ event: "adapter-removed", data })

    // Clean up: remove the corresponding adapter-added event to prevent memory leak
    const addedIndex = this.eventHistory.findIndex(
      e => e.event === "adapter-added" && e.data.adapterId === adapterId,
    )
    if (addedIndex !== -1) {
      this.eventHistory.splice(addedIndex, 1)
    }

    // Emit to current listeners
    this.emitter.emit("adapter-removed", data)
  }

  /**
   * Get all adapter IDs currently in the bridge network
   */
  get adapterIds(): Set<AdapterId> {
    return new Set(this.adapters.keys())
  }
}

type InlineContext = {
  send: (msg: ChannelMsg) => void
  subscribe: (fn: (msg: ChannelMsg) => void) => UnsubscribeFunction
}

type BridgeAdapterParams = {
  adapterId: AdapterId
  bridge: Bridge
  logger?: Logger
}

export class BridgeAdapter extends Adapter<InlineContext> {
  readonly bridge: Bridge
  readonly logger: Logger

  #deinit: (() => void) | undefined
  #unsubscribes: (() => void)[] = []
  #adapterLookup: Map<AdapterId, ChannelId> = new Map()

  constructor({ adapterId, bridge, logger }: BridgeAdapterParams) {
    super({ adapterId })
    this.bridge = bridge
    this.logger = (logger ?? getLogger(["@loro-extended", "repo"])).with({
      adapterId,
    })

    this.logger.trace(`new BridgeAdapter`)
  }

  generate(context: InlineContext): BaseChannel {
    this.logger.trace(`generate`)

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
    this.logger.trace(`init`)

    this.bridge.addAdapter(this)

    // Listen for network events
    this.#unsubscribes.push(
      this.bridge.on("adapter-added", ({ adapterId }) => {
        this.logger.trace(`adapter-added`, { addedAdapterId: adapterId })

        // Don't create a channel to ourselves
        if (adapterId === this.adapterId) {
          this.logger.debug(`adapter-added not creating channel for self`)
          return
        }

        if (this.#adapterLookup.has(adapterId)) {
          this.logger.warn(`adapter-added not re-creating channel`, {
            addedAdapterId: adapterId,
          })
          return
        }

        // When an adapter is added to the bridge, we create a channel between ourselves and that adapter
        const channel = addChannel({
          send: (message: ChannelMsg) => {
            // Send message through the bridge to the target adapter
            this.bridge.send(adapterId, message)
          },

          subscribe: (fn: (msg: ChannelMsg) => void) => {
            return this.bridge.subscribe(this.adapterId, fn)
          },
        })

        this.#adapterLookup.set(adapterId, channel.channelId)
      }),
    )

    this.#unsubscribes.push(
      this.bridge.on("adapter-removed", ({ adapterId }) => {
        const channelId = this.#adapterLookup.get(adapterId)

        if (!channelId) {
          this.logger.warn(`adapter-removed unable to find adapter`, {
            removedAdapterId: adapterId,
          })
          return
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
    this.logger.trace(`start`)

    this.bridge.announceAdapterAdded(this.adapterId)
    // for (const adapterId of this.#bridge.adapterIds) {
    //   this.#bridge.announceAdapterAdded(adapterId)
    // }
    // console.log("start", this.adapterId, {
    //   bridgeAdapters: this.#bridge.adapterIds,
    //   channels: this.#adapterLookup,
    // })
  }

  deinit() {
    this.logger.trace(`deinit`)

    // Announce removal before cleaning up
    this.bridge.announceAdapterRemoved(this.adapterId)

    // Remove from bridge
    this.bridge.removeAdapter(this.adapterId)

    // Clean up event listeners
    this.#deinit?.()
  }
}
