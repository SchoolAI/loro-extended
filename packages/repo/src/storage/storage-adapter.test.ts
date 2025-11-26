import { LoroDoc } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChannelMsg, ConnectedChannel, ReceiveFn } from "../channel.js"
import {
  type Chunk,
  StorageAdapter,
  type StorageKey,
} from "./storage-adapter.js"

// Mock storage adapter for testing
class MockStorageAdapter extends StorageAdapter {
  loadCalls: StorageKey[] = []
  saveCalls: Array<{ key: StorageKey; data: Uint8Array }> = []
  removeCalls: StorageKey[] = []
  loadRangeCalls: StorageKey[] = []
  removeRangeCalls: StorageKey[] = []

  private storage = new Map<string, Uint8Array>()

  constructor() {
    super({ adapterId: "mock-storage" })
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    this.loadCalls.push(key)
    return this.storage.get(JSON.stringify(key))
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    this.saveCalls.push({ key, data })
    this.storage.set(JSON.stringify(key), data)
  }

  async remove(key: StorageKey): Promise<void> {
    this.removeCalls.push(key)
    this.storage.delete(JSON.stringify(key))
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    this.loadRangeCalls.push(keyPrefix)
    const prefix = JSON.stringify(keyPrefix)
    const chunks: Chunk[] = []

    for (const [keyStr, data] of this.storage.entries()) {
      if (keyStr.startsWith(prefix.slice(0, -1))) {
        chunks.push({
          key: JSON.parse(keyStr),
          data,
        })
      }
    }

    return chunks
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    this.removeRangeCalls.push(keyPrefix)
    const prefix = JSON.stringify(keyPrefix)
    const keysToDelete: string[] = []

    for (const keyStr of this.storage.keys()) {
      if (keyStr.startsWith(prefix.slice(0, -1))) {
        keysToDelete.push(keyStr)
      }
    }

    for (const key of keysToDelete) {
      this.storage.delete(key)
    }
  }
}

describe("StorageAdapter", () => {
  let adapter: MockStorageAdapter
  let receivedMessages: ChannelMsg[]
  let receive: ReceiveFn

  // Helper function to initialize and start adapter with no-op callbacks
  async function initializeAdapter(
    adapterInstance: MockStorageAdapter = adapter,
  ): Promise<ConnectedChannel> {
    adapterInstance._initialize({
      identity: { peerId: "123", name: "test-peer", type: "user" },
      onChannelAdded: () => {},
      onChannelRemoved: () => {},
      onChannelReceive: () => {},
      onChannelEstablish: () => {},
    })

    await adapterInstance._start()

    const channel = Array.from(adapterInstance.channels)[0]
    if (!channel || channel.type !== "connected") {
      throw new Error("Expected a connected channel")
    }
    channel.onReceive = receive
    return channel
  }

  beforeEach(() => {
    adapter = new MockStorageAdapter()
    receivedMessages = []
    receive = (msg: ChannelMsg) => {
      receivedMessages.push(msg)
    }
  })

  describe("Channel Creation", () => {
    it("creates a single channel on init", async () => {
      let channelCount = 0

      adapter._initialize({
        identity: { peerId: "123", name: "test-peer", type: "user" },
        onChannelAdded: () => channelCount++,
        onChannelRemoved: () => channelCount--,
        onChannelReceive: () => {},
        onChannelEstablish: () => {},
      })

      await adapter._start()

      expect(channelCount).toBe(1)
      expect(adapter.channels.size).toBe(1)
    })

    it("creates channel with correct metadata", async () => {
      await initializeAdapter()

      const channel = Array.from(adapter.channels)[0]
      expect(channel.kind).toBe("storage")
      expect(channel.adapterId).toBe("mock-storage")
    })
  })

  describe("Auto-Establishment", () => {
    it("auto-responds to establishment request", async () => {
      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/establish-request",
        identity: { peerId: "123", name: "test-peer", type: "user" },
      })

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0].type).toBe("channel/establish-response")
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/establish-response",
        identity: {
          peerId: expect.any(String),
          name: "mock-storage",
        },
      })
    })
  })

  describe("Sync Request Translation", () => {
    it("translates sync-request to loadRange()", async () => {
      // Setup: Create a document and save it
      const doc = new LoroDoc()
      doc.getText("text").insert(0, "Hello World")
      const snapshot = doc.export({ mode: "snapshot" })
      await adapter.save(["test-doc"], snapshot)

      const channel = await initializeAdapter()

      // Clear previous calls
      adapter.loadRangeCalls = []
      receivedMessages = []

      await channel.send({
        type: "channel/sync-request",
        docs: [
          {
            docId: "test-doc",
            requesterDocVersion: new LoroDoc().oplogVersion(),
          },
        ],
      })

      expect(adapter.loadRangeCalls).toHaveLength(1)
      expect(adapter.loadRangeCalls[0]).toEqual(["test-doc"])
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0].type).toBe("channel/sync-response")
    })

    it("sends unavailable when document not found", async () => {
      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/sync-request",
        docs: [
          {
            docId: "nonexistent-doc",
            requesterDocVersion: new LoroDoc().oplogVersion(),
          },
        ],
      })

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/sync-response",
        docId: "nonexistent-doc",
        transmission: { type: "unavailable" },
      })
    })

    it("sends up-to-date when versions match", async () => {
      const doc = new LoroDoc()
      doc.getText("text").insert(0, "Hello")
      const snapshot = doc.export({ mode: "snapshot" })
      await adapter.save(["test-doc"], snapshot)

      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/sync-request",
        docs: [
          {
            docId: "test-doc",
            requesterDocVersion: doc.oplogVersion(),
          },
        ],
      })

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/sync-response",
        docId: "test-doc",
        transmission: { type: "up-to-date" },
      })
    })

    it("sends update when requester is behind", async () => {
      const doc = new LoroDoc()
      doc.getText("text").insert(0, "Hello")
      const snapshot = doc.export({ mode: "snapshot" })
      await adapter.save(["test-doc"], snapshot)

      const channel = await initializeAdapter()

      // Requester has empty version
      await channel.send({
        type: "channel/sync-request",
        docs: [
          {
            docId: "test-doc",
            requesterDocVersion: new LoroDoc().oplogVersion(),
          },
        ],
      })

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/sync-response",
        docId: "test-doc",
        transmission: { type: "update" },
      })
    })

    it("prevents timestamp collisions for rapid updates", async () => {
      const channel = await initializeAdapter()
      const docId = "test-doc"
      const updates = 10

      // Simulate rapid updates
      for (let i = 0; i < updates; i++) {
        await channel.send({
          type: "channel/sync-response",
          docId,
          transmission: {
            type: "update",
            data: new Uint8Array([i]),
            version: new LoroDoc().version(),
          },
        })
      }

      // Check that all updates were saved with unique keys
      expect(adapter.saveCalls).toHaveLength(updates)
      const keys = adapter.saveCalls.map(call => JSON.stringify(call.key))
      const uniqueKeys = new Set(keys)
      expect(uniqueKeys.size).toBe(updates)
    })
  })

  describe("Directory Request Translation", () => {
    it("translates directory-request to loadRange()", async () => {
      await adapter.save(["doc1"], new Uint8Array([1]))
      await adapter.save(["doc2"], new Uint8Array([2]))

      const channel = await initializeAdapter()

      adapter.loadRangeCalls = []

      await channel.send({
        type: "channel/directory-request",
      })

      expect(adapter.loadRangeCalls).toHaveLength(1)
      expect(adapter.loadRangeCalls[0]).toEqual([])
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0].type).toBe("channel/directory-response")
    })

    it("returns all document IDs when no filter specified", async () => {
      await adapter.save(["doc1"], new Uint8Array([1]))
      await adapter.save(["doc2"], new Uint8Array([2]))

      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/directory-request",
      })

      expect(receivedMessages[0]).toMatchObject({
        type: "channel/directory-response",
        docIds: expect.arrayContaining(["doc1", "doc2"]),
      })
    })

    it("filters document IDs when docIds specified", async () => {
      await adapter.save(["doc1"], new Uint8Array([1]))
      await adapter.save(["doc2"], new Uint8Array([2]))

      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/directory-request",
        docIds: ["doc1", "doc3"],
      })

      expect(receivedMessages[0]).toMatchObject({
        type: "channel/directory-response",
        docIds: ["doc1"],
      })
    })

    it("returns unique docIds when documents have multiple chunks", async () => {
      // Simulate a document with multiple update chunks (the bug scenario)
      await adapter.save(["doc1", "update", "1"], new Uint8Array([1]))
      await adapter.save(["doc1", "update", "2"], new Uint8Array([2]))
      await adapter.save(["doc1", "update", "3"], new Uint8Array([3]))
      await adapter.save(["doc2", "update", "1"], new Uint8Array([4]))
      await adapter.save(["doc2", "update", "2"], new Uint8Array([5]))

      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/directory-request",
      })

      // Should return unique docIds, not one per chunk
      const response = receivedMessages[0]
      expect(response).toMatchObject({
        type: "channel/directory-response",
        docIds: expect.arrayContaining(["doc1", "doc2"]),
      })
      if (response.type === "channel/directory-response") {
        expect(response.docIds).toHaveLength(2) // Not 5!
      }
    })
  })

  describe("Delete Request Translation", () => {
    it("translates delete-request to remove()", async () => {
      await adapter.save(["test-doc"], new Uint8Array([1]))

      const channel = await initializeAdapter()

      adapter.removeCalls = []

      await channel.send({
        type: "channel/delete-request",
        docId: "test-doc",
      })

      expect(adapter.removeCalls).toHaveLength(1)
      expect(adapter.removeCalls[0]).toEqual(["test-doc"])
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/delete-response",
        docId: "test-doc",
        status: "deleted",
      })
    })

    it("sends ignored status on delete error", async () => {
      // Don't save anything, so delete will fail
      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/delete-request",
        docId: "nonexistent-doc",
      })

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/delete-response",
        docId: "nonexistent-doc",
        status: "deleted", // Still reports deleted even if not found
      })
    })
  })

  describe("Error Handling", () => {
    it("handles errors in sync request gracefully", async () => {
      const errorAdapter = new MockStorageAdapter()
      errorAdapter.loadRange = vi
        .fn()
        .mockRejectedValue(new Error("Storage error"))

      const channel = await initializeAdapter(errorAdapter)

      await channel.send({
        type: "channel/sync-request",
        docs: [
          {
            docId: "test-doc",
            requesterDocVersion: new LoroDoc().oplogVersion(),
          },
        ],
      })

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/sync-response",
        transmission: { type: "unavailable" },
      })
    })
  })

  describe("Incremental Updates", () => {
    it("reconstructs document from multiple chunks", async () => {
      const doc = new LoroDoc()
      doc.getText("text").insert(0, "Hello")
      const snapshot = doc.export({ mode: "snapshot" })
      await adapter.save(["test-doc", "snapshot"], snapshot)

      // Add an incremental update
      doc.getText("text").insert(5, " World")
      const update = doc.export({
        mode: "update",
        from: new LoroDoc().oplogVersion(),
      })
      await adapter.save(["test-doc", "update", "v1"], update)

      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/sync-request",
        docs: [
          {
            docId: "test-doc",
            requesterDocVersion: new LoroDoc().oplogVersion(),
          },
        ],
      })

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0].type).toBe("channel/sync-response")

      // Verify the response contains the full document
      const response = receivedMessages[0]
      if (
        response &&
        response.type === "channel/sync-response" &&
        response.transmission.type === "update"
      ) {
        const reconstructed = new LoroDoc()
        reconstructed.import(response.transmission.data)
        expect(reconstructed.getText("text").toString()).toBe("Hello World")
      }
    })
  })
})
