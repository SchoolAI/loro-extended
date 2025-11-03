/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { LoroDoc } from "loro-crdt"
import type { Patch } from "mutative"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "./adapter/adapter.js"
import type { BaseChannel, Channel, ChannelMsg } from "./channel.js"
import { createPermissions } from "./rules.js"
import { Synchronizer } from "./synchronizer.js"
import type { ChannelId } from "./types.js"

// Mock adapter for testing
class MockAdapter extends Adapter<{ name: string }> {
  public sentMessages: any[] = []
  private testChannels: Map<ChannelId, Channel> = new Map()

  protected generate(context: { name: string }): BaseChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: vi.fn((message: ChannelMsg) => {
        this.sentMessages.push({ channelId: context.name, message })
      }),
      start: vi.fn(),
      stop: vi.fn(),
    }
  }

  onBeforeStart({
    addChannel,
    removeChannel,
  }: {
    addChannel: (context: { name: string }) => Channel
    removeChannel: (id: ChannelId) => Channel | undefined
  }) {
    // Store references for testing
    this.addChannel = addChannel
    this.removeChannel = removeChannel
  }

  onAfterStop() {
    console.log("deinited!")
    this.testChannels.clear()
  }

  onStart() {
    // do we need to listen or do anything?
  }

  // Test helpers
  public addChannel?: (context: { name: string }) => Channel
  public removeChannel?: (id: ChannelId) => Channel | undefined

  public simulateChannelAdded(name: string): Channel {
    if (!this.addChannel) throw new Error("Adapter not initialized")
    const channel = this.addChannel({ name })
    this.testChannels.set(channel.channelId, channel)
    return channel
  }

  public simulateChannelRemoved(channelId: ChannelId): Channel | undefined {
    if (!this.removeChannel) throw new Error("Adapter not initialized")
    const channel = this.removeChannel(channelId)
    if (channel) {
      this.testChannels.delete(channelId)
    }
    return channel
  }

  public simulateChannelMessage(channelId: ChannelId, message: ChannelMsg) {
    const channel = this.testChannels.get(channelId)
    if (channel?.start) {
      // Simulate receiving a message through the channel's receive callback
      const mockReceive = vi.mocked(channel.start).mock.calls[0]?.[0]
      if (mockReceive) {
        mockReceive(message)
      }
    }
  }

  public getTestChannels() {
    return this.testChannels
  }
}

// Helper to create a version vector
function createVersionVector() {
  const doc = new LoroDoc()
  return doc.version()
}

describe("Synchronizer - Refactored", () => {
  let synchronizer: Synchronizer
  let mockAdapter: MockAdapter
  let patches: Patch[]
  let onPatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    patches = []
    onPatch = vi.fn((newPatches: Patch[]) => {
      patches.push(...newPatches)
    })

    mockAdapter = new MockAdapter({ adapterId: "test-adapter" })
    synchronizer = new Synchronizer({
      identity: { name: "test-synchronizer" },
      adapters: [mockAdapter as AnyAdapter],
      permissions: createPermissions(),
      onUpdate: onPatch,
    })
  })

  describe("initialization", () => {
    it("should initialize with provided identity", () => {
      const sync = new Synchronizer({
        identity: { name: "custom-name" },
        adapters: [],
      })

      expect(sync.identity.name).toBe("custom-name")
    })

    it("should generate identity name if not provided", () => {
      const sync = new Synchronizer({
        identity: {},
        adapters: [],
      })

      expect(sync.identity.name).toMatch(/^synchronizer-/)
    })

    it("should initialize adapters", () => {
      expect(mockAdapter.addChannel).toBeDefined()
      expect(mockAdapter.removeChannel).toBeDefined()
    })

    it("should create permissions manager", () => {
      const restrictiveSync = new Synchronizer({
        identity: { name: "test" },
        adapters: [],
        permissions: createPermissions({
          canReveal: () => false,
        }),
      })

      expect(restrictiveSync).toBeDefined()
    })

    it("should set up patch callback if provided", () => {
      // The onPatch callback should be set up during initialization
      expect(onPatch).toBeDefined()
    })
  })

  describe("document state management", () => {
    it("should create document state when requested", () => {
      const docId = "test-doc"
      const docState = synchronizer.getOrCreateDocumentState(docId)

      expect(docState).toBeDefined()
      expect(docState.docId).toBe(docId)
      expect(docState.doc).toBeInstanceOf(LoroDoc)
      expect(docState.channelState).toBeInstanceOf(Map)
    })

    it("should return existing document state", () => {
      const docId = "test-doc"
      const docState1 = synchronizer.getOrCreateDocumentState(docId)
      const docState2 = synchronizer.getOrCreateDocumentState(docId)

      expect(docState1).toBe(docState2)
    })

    it("should return undefined for non-existent document", () => {
      const docState = synchronizer.getDocumentState("non-existent")
      expect(docState).toBeUndefined()
    })

    it("should get model snapshot", () => {
      const docId = "test-doc"
      synchronizer.getOrCreateDocumentState(docId)

      const snapshot = synchronizer.getModelSnapshot()
      expect(snapshot.identity).toEqual(synchronizer.identity)
      expect(snapshot.documents.has(docId)).toBe(true)
      expect(snapshot.channels).toBeInstanceOf(Map)
    })
  })

  describe("channel management", () => {
    it("should handle channel addition", () => {
      const channel = mockAdapter.simulateChannelAdded("test-channel")

      expect(synchronizer.getChannel(channel.channelId)).toBe(channel)
      expect(channel.start).toHaveBeenCalled()
    })

    it("should handle channel removal", () => {
      const channel = mockAdapter.simulateChannelAdded("test-channel")
      expect(synchronizer.getChannel(channel.channelId)).toBe(channel)

      mockAdapter.simulateChannelRemoved(channel.channelId)
      expect(synchronizer.getChannel(channel.channelId)).toBeUndefined()
      expect(channel.stop).toHaveBeenCalled()
    })

    it("should return undefined for non-existent channel", () => {
      const channel = synchronizer.getChannel(999)
      expect(channel).toBeUndefined()
    })
  })

  describe("channel queries", () => {
    it("should get channels for document with predicate", () => {
      const docId = "test-doc"
      const docState = synchronizer.getOrCreateDocumentState(docId)
      const channel = mockAdapter.simulateChannelAdded("test-channel")

      // Add channel state to document
      docState.channelState.set(channel.channelId, {
        awareness: "has-doc",
        loading: { state: "found", version: createVersionVector() },
      })

      const channels = synchronizer.getChannelsForDoc(
        docId,
        loading => loading.state === "found",
      )

      expect(channels).toHaveLength(1)
      expect(channels[0]).toBe(channel)
    })

    it("should throw error for non-existent document in getChannelsForDoc", () => {
      expect(() => {
        synchronizer.getChannelsForDoc("non-existent", () => true)
      }).toThrow("doc state not found for non-existent")
    })

    it("should get document IDs for channel", () => {
      const docId1 = "doc-1"
      const docId2 = "doc-2"
      const channel = mockAdapter.simulateChannelAdded("test-channel")

      const docState1 = synchronizer.getOrCreateDocumentState(docId1)
      const docState2 = synchronizer.getOrCreateDocumentState(docId2)

      // Add channel state to documents
      docState1.channelState.set(channel.channelId, {
        awareness: "has-doc",
        loading: { state: "initial" },
      })
      docState2.channelState.set(channel.channelId, {
        awareness: "has-doc",
        loading: { state: "initial" },
      })

      const docIds = synchronizer.getChannelDocIds(channel.channelId)
      expect(docIds).toContain(docId1)
      expect(docIds).toContain(docId2)
      expect(docIds).toHaveLength(2)
    })
  })

  describe("sync functionality", () => {
    it("should handle sync response with document data", () => {
      const docId = "test-doc"
      const channel = mockAdapter.simulateChannelAdded("test-channel")
      const docState = synchronizer.getOrCreateDocumentState(docId)

      // Establish the channel first
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/establish-request",
        identity: { name: "test-peer" },
      })

      // Add channel state
      docState.channelState.set(channel.channelId, {
        awareness: "unknown",
        loading: { state: "requesting" },
      })

      // Create valid document data
      const sourceDoc = new LoroDoc()
      sourceDoc.getText("test").insert(0, "hello world")
      const data = sourceDoc.export({ mode: "snapshot" })

      // Simulate receiving sync response
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/sync-response",
        docId,
        transmission: {
          type: "snapshot",
          data,
          version: sourceDoc.version(),
        },
        hopCount: 0,
      })

      // Document should have imported the data
      const updatedDocState = synchronizer.getDocumentState(docId)
      expect(updatedDocState?.doc.toJSON()).toEqual({ test: "hello world" })
    })
  })

  describe("event emission", () => {
    it("should emit ready-state-changed events", async () => {
      const docId = "test-doc"
      const channel = mockAdapter.simulateChannelAdded("test-channel")
      const docState = synchronizer.getOrCreateDocumentState(docId)

      // Set up event listener
      const readyStatePromise = new Promise(resolve => {
        synchronizer.emitter.on("ready-state-changed", resolve)
      })

      // Add channel state that will trigger ready state change
      docState.channelState.set(channel.channelId, {
        awareness: "unknown",
        loading: { state: "requesting" },
      })

      // Simulate sync response that changes loading state
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/sync-response",
        docId,
        transmission: {
          type: "up-to-date",
          version: createVersionVector(),
        },
        hopCount: 0,
      })

      const event = await readyStatePromise
      expect(event).toMatchObject({
        docId,
        readyStates: expect.any(Array),
      })
    })

    it("should support waitUntilReady with predicate", async () => {
      const docId = "test-doc"
      const channel = mockAdapter.simulateChannelAdded("test-channel")
      const docState = synchronizer.getOrCreateDocumentState(docId)

      // Set up channel state
      docState.channelState.set(channel.channelId, {
        awareness: "unknown",
        loading: { state: "requesting" },
      })

      // Start waiting for ready state
      const waitPromise = synchronizer.waitUntilReady(docId, readyStates =>
        readyStates.some(state => state.loading.state === "found"),
      )

      // Simulate sync response that satisfies the predicate
      setTimeout(() => {
        mockAdapter.simulateChannelMessage(channel.channelId, {
          type: "channel/sync-response",
          docId,
          transmission: {
            type: "up-to-date",
            version: createVersionVector(),
          },
          hopCount: 0,
        })
      }, 10)

      // Should resolve when predicate is satisfied
      await expect(waitPromise).resolves.toBeUndefined()
    })
  })

  describe("command execution", () => {
    it("should execute send-sync-response command", () => {
      const docId = "test-doc"
      const channel = mockAdapter.simulateChannelAdded("test-channel")
      const docState = synchronizer.getOrCreateDocumentState(docId)

      // Add some content to the document
      docState.doc.getText("test").insert(0, "hello")

      // Add channel state
      docState.channelState.set(channel.channelId, {
        awareness: "has-doc",
        loading: { state: "initial" },
      })

      // Simulate sync request that should trigger sync response
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/sync-request",
        docs: [
          {
            docId,
            requesterDocVersion: createVersionVector(),
          },
        ],
      })

      // Should have sent messages: establish-request + establish-response + sync-response
      expect(mockAdapter.sentMessages.length).toBeGreaterThanOrEqual(2)
      const syncResponse = mockAdapter.sentMessages.find(
        msg => msg.message.type === "channel/sync-response",
      )
      expect(syncResponse).toBeDefined()
      expect(syncResponse.message.docId).toBe(docId)
    })

    it("should handle establish channel doc command", () => {
      const channel = mockAdapter.simulateChannelAdded("test-channel")

      // Simulate establish request/response to get channel into established state
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/establish-request",
        identity: { name: "requester-peer" },
      })

      // Channel should be in established state
      const updatedChannel = synchronizer.getChannel(channel.channelId)
      expect(updatedChannel?.peer.state).toBe("established")
    })

    it("should handle batch commands", () => {
      const channel = mockAdapter.simulateChannelAdded("test-channel")

      // Simulate establish request which should generate batch command
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/establish-request",
        identity: { name: "requester-peer" },
      })

      // Should have executed multiple commands (establish + send message)
      expect(mockAdapter.sentMessages.length).toBeGreaterThan(1)
    })
  })

  describe("reset functionality", () => {
    it("should reset synchronizer state", () => {
      const docId = "test-doc"
      const channel = mockAdapter.simulateChannelAdded("test-channel")
      synchronizer.getOrCreateDocumentState(docId)

      // Verify initial state
      expect(synchronizer.getDocumentState(docId)).toBeDefined()
      expect(synchronizer.getChannel(channel.channelId)).toBeDefined()

      // Reset
      synchronizer.reset()

      // State should be reset
      expect(synchronizer.getDocumentState(docId)).toBeUndefined()
      expect(synchronizer.getChannel(channel.channelId)).toBeUndefined()
      expect(mockAdapter.channels.size).toBe(0)
    })
  })

  describe("permissions integration", () => {
    it("should respect permissions in directory requests", () => {
      const restrictiveSync = new Synchronizer({
        identity: { name: "test" },
        adapters: [mockAdapter as AnyAdapter],
        permissions: createPermissions({
          canReveal: context => context.docId !== "secret-doc",
        }),
      })

      // Create documents
      const publicDoc = restrictiveSync.getOrCreateDocumentState("public-doc")
      const secretDoc = restrictiveSync.getOrCreateDocumentState("secret-doc")

      const channel = mockAdapter.simulateChannelAdded("test-channel")

      // Establish the channel first so getRuleContext works
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/establish-request",
        identity: { name: "requester-peer" },
      })

      // Add channel state to documents so they're associated with the channel
      publicDoc.channelState.set(channel.channelId, {
        awareness: "has-doc",
        loading: { state: "initial" },
      })
      secretDoc.channelState.set(channel.channelId, {
        awareness: "has-doc",
        loading: { state: "initial" },
      })

      // Clear previous messages
      mockAdapter.sentMessages = []

      // Simulate directory request
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/directory-request",
      })

      // Should only return public documents
      const directoryResponse = mockAdapter.sentMessages.find(
        msg => msg.message.type === "channel/directory-response",
      )
      expect(directoryResponse).toBeDefined()
      expect(directoryResponse.message.docIds).toContain("public-doc")
      expect(directoryResponse.message.docIds).not.toContain("secret-doc")
    })
  })

  describe("patch generation", () => {
    it("should generate patches when onPatch is provided", () => {
      mockAdapter.simulateChannelAdded("test-channel")

      expect(onPatch).toHaveBeenCalled()
      expect(patches.length).toBeGreaterThan(0)

      // Should contain channel-related patches
      const channelPatch = patches.find(p => p.path[0] === "channels")
      expect(channelPatch).toBeDefined()
    })

    it("should work without onPatch callback", () => {
      const syncWithoutPatch = new Synchronizer({
        identity: { name: "test" },
        adapters: [new MockAdapter({ adapterId: "test" }) as AnyAdapter],
      })

      // Should not throw when no patch callback is provided
      expect(syncWithoutPatch).toBeDefined()
    })
  })

  describe("adapter integration", () => {
    it("should send messages through adapters", () => {
      mockAdapter.simulateChannelAdded("test-channel")

      // Should have sent establish-request message
      expect(mockAdapter.sentMessages).toHaveLength(1)
      expect(mockAdapter.sentMessages[0].message.type).toBe(
        "channel/establish-request",
      )
    })

    it("should handle multiple adapters", () => {
      const adapter1 = new MockAdapter({ adapterId: "adapter-1" })
      const adapter2 = new MockAdapter({ adapterId: "adapter-2" })

      const multiSync = new Synchronizer({
        identity: { name: "test" },
        adapters: [adapter1 as AnyAdapter, adapter2 as AnyAdapter],
      })

      const channel1 = adapter1.simulateChannelAdded("channel-1")
      const channel2 = adapter2.simulateChannelAdded("channel-2")

      expect(multiSync.getChannel(channel1.channelId)).toBeDefined()
      expect(multiSync.getChannel(channel2.channelId)).toBeDefined()
    })
  })
})
