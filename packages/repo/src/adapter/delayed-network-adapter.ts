/**
 * A test adapter that simulates network latency between channel establishment
 * and sync-response delivery. Useful for testing timing-sensitive scenarios.
 *
 * @example
 * ```typescript
 * const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
 * const repo = new Repo({
 *   identity: { name: "client", type: "user" },
 *   adapters: [adapter],
 * })
 *
 * const doc = repo.get("test-doc", DocSchema)
 *
 * // Later, simulate server response
 * await adapter.deliverSyncResponse("test-doc", serverSnapshot)
 * // Or simulate server doesn't have the document
 * await adapter.deliverUnavailable("test-doc")
 * ```
 */

import { LoroDoc, type PeerID } from "loro-crdt"
import type { ChannelMsg, GeneratedChannel } from "../channel.js"
import { Adapter } from "./adapter.js"

export type DelayedNetworkAdapterOptions = {
  /**
   * Delay in milliseconds before delivering sync responses.
   */
  syncResponseDelay: number

  /**
   * The peer ID to use for the simulated server.
   * @default "server"
   */
  serverPeerId?: PeerID

  /**
   * The name to use for the simulated server.
   * @default "server"
   */
  serverName?: string
}

export class DelayedNetworkAdapter extends Adapter<void> {
  private channel?: ReturnType<typeof this.addChannel>
  private syncResponseDelay: number
  private serverPeerId: PeerID
  private serverName: string

  /**
   * Callback invoked when a sync-request is received.
   * Useful for tests that need to know when to deliver responses.
   */
  public onSyncRequestReceived?: (docId: string) => void

  constructor(options: DelayedNetworkAdapterOptions) {
    super({ adapterType: "delayed-network" })
    this.syncResponseDelay = options.syncResponseDelay
    this.serverPeerId = options.serverPeerId ?? ("server" as PeerID)
    this.serverName = options.serverName ?? "server"
  }

  protected generate(): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
      send: (msg: ChannelMsg) => {
        // Intercept sync-request to notify test
        if (msg.type === "channel/sync-request") {
          this.onSyncRequestReceived?.(msg.docId)
        }
      },
      stop: () => {
        // No-op
      },
    }
  }

  async onStart(): Promise<void> {
    // Create and establish channel immediately (simulating WebSocket connect)
    this.channel = this.addChannel()
    this.establishChannel(this.channel.channelId)

    // Simulate server responding to establish-request
    this.channel.onReceive({
      type: "channel/establish-response",
      identity: {
        peerId: this.serverPeerId,
        name: this.serverName,
        type: "service",
      },
    })
  }

  async onStop(): Promise<void> {
    if (this.channel) {
      this.removeChannel(this.channel.channelId)
    }
  }

  /**
   * Simulate the server sending a sync-response with document data.
   *
   * @param docId - The document ID
   * @param data - The document snapshot data (from loroDoc.export({ mode: "snapshot" }))
   */
  async deliverSyncResponse(docId: string, data: Uint8Array): Promise<void> {
    if (!this.channel) {
      throw new Error("Channel not established")
    }

    // Wait for the configured delay
    await new Promise(resolve => setTimeout(resolve, this.syncResponseDelay))

    // Import the data into a temporary doc to get the version
    const tempDoc = new LoroDoc()
    tempDoc.import(data)

    // Deliver the sync-response
    this.channel.onReceive({
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "snapshot",
        data,
        version: tempDoc.version(),
      },
    })
  }

  /**
   * Simulate the server responding that it doesn't have the document.
   *
   * @param docId - The document ID
   */
  async deliverUnavailable(docId: string): Promise<void> {
    if (!this.channel) {
      throw new Error("Channel not established")
    }

    await new Promise(resolve => setTimeout(resolve, this.syncResponseDelay))

    this.channel.onReceive({
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "unavailable",
      },
    })
  }
}
