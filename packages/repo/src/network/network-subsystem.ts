import Emittery from "emittery"
import { type Result, withTimeout } from "src/utils/with-timeout.js"
import type { ChannelId } from "../types.js"
import type { NetworkAdapter, NetworkAdapterEvents } from "./network-adapter.js"
import type { AddressedChannelMsg } from "../channel.js"

type UnsubscribeFunction = () => void

export type NetworkSubsystemServices = {
  isPeerConnected: (peerId: ChannelId) => boolean
}

/**
 * The NetworkSubsystem is a NetworkAdapter router: its sole job is to abstract all
 * of the adapters into a single interface. Messages from each adapter are routed through
 * NetworkSubsystem, and messages to a peer are sent via the `send` method.
 */
export class NetworkSubsystem extends Emittery<NetworkAdapterEvents> {
  #peerId: ChannelId
  #adapters: NetworkAdapter[]
  #services: NetworkSubsystemServices
  #unsubscribeFunctions = new Map<NetworkAdapter, UnsubscribeFunction[]>()

  constructor({
    peerId,
    adapters,
    services,
  }: {
    peerId: ChannelId
    adapters: NetworkAdapter[]
    services: NetworkSubsystemServices
  }) {
    super()
    this.#peerId = peerId
    this.#adapters = adapters
    this.#services = services
  }

  startAdapters() {
    for (const adapter of this.#adapters) {
      this.startAdapter(adapter)
    }
  }

  startAdapter(adapter: NetworkAdapter) {
    // Start the adapter
    adapter.start(this.#peerId, {})

    // Store unsubscribe functions for proper cleanup
    const unsubscribes: UnsubscribeFunction[] = [
      adapter.on("peer-available", event => {
        this.emit("peer-available", event)
      }),
      adapter.on("peer-disconnected", event => {
        this.emit("peer-disconnected", event)
      }),
      adapter.on("message-received", event => {
        this.emit("message-received", event)
      }),
    ]

    this.#unsubscribeFunctions.set(adapter, unsubscribes)

    // Mark the adapter as ready, which will emit any queued events
    adapter.markAsReady()
  }

  async send(message: AddressedChannelMsg): Promise<void> {
    // Filter targetIds based on connectivity and permissions
    const filteredTargetIds = message.targetIds.filter(targetId => {
      // Check if peer is connected
      if (!this.#services.isPeerConnected(targetId)) {
        console.warn(
          `[NetworkSubsystem] Tried to send message to disconnected peer ${targetId}`,
        )
        return false
      }

      return true
    })

    // Only send if there are valid targets
    if (filteredTargetIds.length > 0) {
      const filteredMessage = {
        ...message,
        senderId: this.#peerId,
        targetIds: filteredTargetIds,
      }

      // First adapter to report success wins; part of the NetworkAdapter contract is that
      // an adapter MUST throw an error if it is unable to deliver a message on `send`.
      const result = await Promise.race<Result<boolean, Error>>(
        this.#adapters.map(async adapter => {
          try {
            await adapter.send(filteredMessage)
            return { type: "success" as const, result: true }
          } catch (error) {
            if (error instanceof Error) {
              return { type: "error" as const, error }
            } else {
              return { type: "error" as const, error: new Error("Skipped") }
            }
          }
        }),
      )

      // Log for now; TODO(duane): provide log level configuration
      if (result.type === "error") {
        console.error("send error", result.error)
      }
    }
  }

  async stopAll(timeout: number = 5000) {
    const results = await Promise.all(
      this.#adapters.map(async adapter => {
        try {
          this.stopAdapter(adapter)
          const stopResult = await withTimeout(() => adapter.stop(), timeout)
          if (stopResult.type === "error") {
            return {
              type: "error",
              error: stopResult.error,
              adapter,
            }
          }

          return {
            type: "success",
            result: stopResult.result,
            adapter,
          }
        } catch (error) {
          return { type: "error", error, adapter }
        }
      }),
    )

    for (const result of results) {
      if (result.type === "error") {
        console.error("Error stopping adapter", {
          error: result.error,
          adapter: result.adapter.constructor.name,
        })
      }
    }
  }

  stopAdapter(adapter: NetworkAdapter) {
    // Call all unsubscribe functions for this adapter
    const unsubscribes = this.#unsubscribeFunctions.get(adapter)
    if (unsubscribes) {
      unsubscribes.forEach(unsubscribe => unsubscribe())
      this.#unsubscribeFunctions.delete(adapter)
    }
  }

  // Keep the old method for backward compatibility during transition
  async disconnectAll(timeout: number = 5000) {
    return this.stopAll(timeout)
  }
}
