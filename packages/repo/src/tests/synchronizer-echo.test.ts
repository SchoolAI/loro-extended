import { LoroDoc } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "../adapter/adapter.js"
import type {
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "../channel.js"
import { createRules } from "../rules.js"
import { Synchronizer } from "../synchronizer.js"
import type { ChannelId } from "../types.js"

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
      m =>
        m.message.type === "channel/sync-response" && m.message.docId === docId,
    )

    expect(echoResponse).toBeUndefined()
  })

  it("should update peer awareness to our version after import (not peer's sent version)", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc-2"
    const channel = mockAdapter.simulateChannelAdded("test-channel-2")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "3", name: "test-peer-2", type: "user" },
    })

    // Simulate peer subscription (via sync-request)
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [{ docId, requesterDocVersion: docState.doc.version() }],
      bidirectional: true,
    })

    // Clear sent messages
    mockAdapter.sentMessages = []

    // Create valid document data from peer
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("test").insert(0, "hello world")
    sourceDoc.commit()
    const data = sourceDoc.export({ mode: "snapshot" })
    const peerSentVersion = sourceDoc.version()

    // Simulate receiving sync response from peer
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "snapshot",
        data,
        version: peerSentVersion,
      },
    })

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 100))

    // After import, our version should be the same as what we imported
    // (since we had no local changes)
    const ourVersionAfterImport = docState.doc.version()

    // The peer awareness should be updated to our current version (after import)
    // NOT the version the peer sent (which might be different if we had local changes)
    const peerState = synchronizer.getPeerState("3")
    const peerAwareness = peerState?.documentAwareness.get(docId)

    // The key check: our version compared to peer awareness should be 0 (equal)
    // If it's 1 (we're ahead), that would trigger an echo
    const peerAwarenessVersion = peerAwareness?.lastKnownVersion
    if (!peerAwarenessVersion) {
      throw new Error("Peer awareness version should exist")
    }
    const comparison = ourVersionAfterImport.compare(peerAwarenessVersion)

    // This should be 0 (equal) - if it's 1, we'd send an echo
    expect(comparison).toBe(0)
  })

  it("should NOT echo when we have local changes AND receive peer data", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc-3"
    const channel = mockAdapter.simulateChannelAdded("test-channel-3")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Make LOCAL changes first (before receiving peer data)
    docState.doc.getText("local").insert(0, "local changes")
    docState.doc.commit()

    // Establish the channel
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "4", name: "test-peer-3", type: "user" },
    })

    // Simulate peer subscription
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [{ docId, requesterDocVersion: docState.doc.version() }],
      bidirectional: true,
    })

    // Clear sent messages
    mockAdapter.sentMessages = []

    // Create document data from peer (different changes)
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("peer").insert(0, "peer changes")
    sourceDoc.commit()
    const data = sourceDoc.export({ mode: "snapshot" })
    const peerSentVersion = sourceDoc.version()

    // Simulate receiving sync response from peer
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "snapshot",
        data,
        version: peerSentVersion,
      },
    })

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 100))

    // Check if we sent any sync-response back (echo)
    const echoResponse = mockAdapter.sentMessages.find(
      m =>
        m.message.type === "channel/sync-response" && m.message.docId === docId,
    )

    // This is the key assertion - we should NOT send an echo
    expect(echoResponse).toBeUndefined()
  })
})
