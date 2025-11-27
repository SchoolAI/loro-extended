import { LoroDoc } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "./adapter/adapter.js"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "./channel.js"
import { createRules } from "./rules.js"
import { Synchronizer } from "./synchronizer.js"
import type { ChannelId } from "./types.js"

// Mock adapter for testing
class MockAdapter extends Adapter<{ name: string }> {
  public sentMessages: any[] = []
  private testChannels: Map<ChannelId, ConnectedChannel> = new Map()
  private startPromise: Promise<void> | null = null

  protected generate(context: { name: string }): GeneratedChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
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

  public simulateChannelMessage(channelId: ChannelId, message: ChannelMsg) {
    const channel = this.testChannels.get(channelId)
    if (channel?.onReceive) {
      channel.onReceive(message)
    }
  }
}

describe("Synchronizer - Echo Prevention", () => {
  let synchronizer: Synchronizer
  let mockAdapter: MockAdapter

  beforeEach(() => {
    mockAdapter = new MockAdapter({ adapterId: "test-adapter" })
    synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-synchronizer", type: "user" },
      adapters: [mockAdapter as AnyAdapter],
      rules: createRules(),
    })
  })

  it("should compare empty versions correctly", () => {
    const doc1 = new LoroDoc()
    const doc2 = new LoroDoc()
    const v1 = doc1.version()
    const v2 = doc2.version()
    expect(v1.compare(v2)).toBe(0)
  })

  it("should NOT send a sync-response back when receiving one (echo prevention)", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "2", name: "test-peer", type: "user" },
    })

    // Simulate peer subscription (via sync-request)
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [{ docId, requesterDocVersion: docState.doc.version() }],
      bidirectional: true,
    })

    // Clear sent messages (ignore the sync-response to the request)
    mockAdapter.sentMessages = []

    // Create valid document data from peer
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("test").insert(0, "hello world")
    sourceDoc.commit()
    const data = sourceDoc.export({ mode: "snapshot" })
    const version = sourceDoc.version()
    console.log("Source doc version:", JSON.stringify(version.toJSON()))
    console.log("Source doc version length:", version.length())
    
    // Check our doc version before import
    console.log("Our doc version before import:", JSON.stringify(docState.doc.version().toJSON()))
    console.log("Our doc version length before import:", docState.doc.version().length())

    // Simulate receiving sync response (update) from peer
    // This should import the data and update peer awareness
    // It should NOT trigger a sync-response back to the peer
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "snapshot",
        data,
        version,
      },
    })

    // Wait for any potential async operations
    await new Promise(resolve => setTimeout(resolve, 100))

    // Check if we sent any sync-response back
    const echoResponse = mockAdapter.sentMessages.find(
      m => m.message.type === "channel/sync-response" && m.message.docId === docId
    )

    // If we sent a response, it means we thought the peer was behind
    // This happens if we import data (triggering doc-change) BEFORE updating peer awareness
    if (echoResponse) {
      console.log("Echo response found:", JSON.stringify(echoResponse, null, 2))
    }

    expect(echoResponse).toBeUndefined()
  })
})