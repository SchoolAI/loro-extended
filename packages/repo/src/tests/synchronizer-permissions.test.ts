/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { Shape } from "@loro-extended/change"
import { describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "../adapter/adapter.js"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "../channel.js"
import { Repo } from "../repo.js"
import { createRules } from "../rules.js"
import { Synchronizer } from "../synchronizer.js"
import type { ChannelId } from "../types.js"

// Schema for test documents
const DocSchema = Shape.doc({
  title: Shape.text(),
})

// Mock adapter for testing
class MockAdapter extends Adapter<{ name: string }> {
  public sentMessages: any[] = []
  private testChannels: Map<ChannelId, ConnectedChannel> = new Map()
  private startPromise: Promise<void> | null = null

  protected generate(context: { name: string }): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
      send: vi.fn((message: ChannelMsg) => {
        this.sentMessages.push({ channelId: context.name, message })
      }),
      stop: vi.fn(),
    }
  }

  async onStart(): Promise<void> {
    // Nothing to do for mock adapter
  }

  async onStop(): Promise<void> {
    this.testChannels.clear()
  }

  // Override _start to track when it completes
  async _start(): Promise<void> {
    this.startPromise = super._start()
    await this.startPromise
  }

  // Wait for adapter to be started
  async waitForStart(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise
    }
  }

  // Test helpers
  public simulateChannelAdded(name: string): ConnectedChannel {
    const channel = this.addChannel({ name })
    this.testChannels.set(channel.channelId, channel)
    // Establish the channel to trigger the establishment handshake
    this.establishChannel(channel.channelId)
    return channel
  }

  public simulateChannelRemoved(channelId: ChannelId): Channel | undefined {
    const channel = this.removeChannel(channelId)
    if (channel) {
      this.testChannels.delete(channelId)
    }
    return channel
  }

  public simulateChannelMessage(channelId: ChannelId, message: ChannelMsg) {
    const channel = this.testChannels.get(channelId)
    if (channel?.onReceive) {
      channel.onReceive(message)
    }
  }

  public getTestChannels() {
    return this.testChannels
  }
}

describe("Synchronizer - Permissions Integration", () => {
  it("should respect permissions in directory requests", async () => {
    // Create a fresh adapter for this test to avoid reuse issues
    const freshAdapter = new MockAdapter({ adapterType: "test-adapter-2" })
    const restrictiveSync = new Synchronizer({
      identity: { peerId: "1", name: "test", type: "user" },
      adapters: [freshAdapter as AnyAdapter],
      rules: createRules({
        canReveal: context => context.docId !== "secret-doc",
      }),
    })

    // Create documents
    restrictiveSync.getOrCreateDocumentState("public-doc")
    restrictiveSync.getOrCreateDocumentState("secret-doc")

    await freshAdapter.waitForStart()
    const channel = freshAdapter.simulateChannelAdded("test-channel")

    // Establish the channel first so getRuleContext works
    freshAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1" as any, name: "requester-peer", type: "user" },
    })

    // Clear previous messages
    freshAdapter.sentMessages = []

    // Simulate directory request
    freshAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/directory-request",
    })

    // Should only return public documents
    const directoryResponse = freshAdapter.sentMessages.find(
      msg => msg.message.type === "channel/directory-response",
    )
    expect(directoryResponse).toBeDefined()
    expect(directoryResponse.message.docIds).toContain("public-doc")
    expect(directoryResponse.message.docIds).not.toContain("secret-doc")
  })

  it("should create document on sync-request if allowed", async () => {
    // Setup bridge for communication
    const bridge = new Bridge()

    const adapter1 = new BridgeAdapter({ adapterType: "adapter1", bridge })
    const adapter2 = new BridgeAdapter({ adapterType: "adapter2", bridge })

    const repo1 = new Repo({
      identity: { name: "Peer 1", type: "user" },
      adapters: [adapter1],
    })

    const repo2 = new Repo({
      identity: { name: "Peer 2", type: "user" },
      adapters: [adapter2],
      rules: {
        canCreate: () => true, // Allow creation
      },
    })

    // Repo1 creates a handle (but doesn't change it yet)
    // This sends a sync-request to Repo2
    repo1.get("test-doc-1", DocSchema)

    // Wait for sync to happen
    await new Promise(resolve => setTimeout(resolve, 100))

    // Repo2 should have the document now
    expect(repo2.has("test-doc-1")).toBe(true)
  })

  it("should NOT create document on sync-request if NOT allowed", async () => {
    // Setup bridge for communication
    const bridge = new Bridge()

    const adapter1 = new BridgeAdapter({ adapterType: "adapter1", bridge })
    const adapter2 = new BridgeAdapter({ adapterType: "adapter2", bridge })

    const repo1 = new Repo({
      identity: { name: "Peer 1", type: "user" },
      adapters: [adapter1],
    })

    const repo2 = new Repo({
      identity: { name: "Peer 2", type: "user" },
      adapters: [adapter2],
      rules: {
        canCreate: () => false, // Deny creation
      },
    })

    // Repo1 creates a handle
    repo1.get("test-doc-2", DocSchema)

    // Wait for sync to happen
    await new Promise(resolve => setTimeout(resolve, 100))

    // Repo2 should NOT have the document
    expect(repo2.has("test-doc-2")).toBe(false)
  })
})
