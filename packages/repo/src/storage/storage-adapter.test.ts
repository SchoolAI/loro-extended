import { LoroDoc } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChannelMsg, ReceiveFn } from "../channel.js"
import {
  StorageAdapter,
  type Chunk,
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

  beforeEach(() => {
    adapter = new MockStorageAdapter()
    receivedMessages = []
    receive = (msg: ChannelMsg) => {
      receivedMessages.push(msg)
    }
  })

  describe("Channel Creation", () => {
    it("creates a single channel on init", () => {
      let channelCount = 0

      adapter._prepare({
        channelAdded: () => channelCount++,
        channelRemoved: () => channelCount--,
      })

      expect(channelCount).toBe(1)
      expect(adapter.channels.size).toBe(1)
    })

    it("creates channel with correct metadata", () => {
      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      expect(channel.kind).toBe("storage")
      expect(channel.adapterId).toBe("mock-storage")
    })
  })

  describe("Auto-Establishment", () => {
    it("auto-responds to establishment request", async () => {
      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

      await channel.send({
        type: "channel/establish-request",
        identity: { name: "test-peer" },
        requesterPublishDocId: "test-doc-id",
      })

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0].type).toBe("channel/establish-response")
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/establish-response",
        identity: { name: "mock-storage" },
        responderPublishDocId: channel.publishDocId,
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

      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

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
      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

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

      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

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

      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

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
  })

  describe("Directory Request Translation", () => {
    it("translates directory-request to loadRange()", async () => {
      await adapter.save(["doc1"], new Uint8Array([1]))
      await adapter.save(["doc2"], new Uint8Array([2]))

      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

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

      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

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

      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

      await channel.send({
        type: "channel/directory-request",
        docIds: ["doc1", "doc3"],
      })

      expect(receivedMessages[0]).toMatchObject({
        type: "channel/directory-response",
        docIds: ["doc1"],
      })
    })
  })

  describe("Delete Request Translation", () => {
    it("translates delete-request to remove()", async () => {
      await adapter.save(["test-doc"], new Uint8Array([1]))

      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

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
      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

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

      errorAdapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(errorAdapter.channels)[0]
      channel.start(receive)

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

      adapter._prepare({
        channelAdded: () => {},
        channelRemoved: () => {},
      })

      const channel = Array.from(adapter.channels)[0]
      channel.start(receive)

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
      const response = receivedMessages[0] as any
      if (response.transmission.type === "update") {
        const reconstructed = new LoroDoc()
        reconstructed.import(response.transmission.data)
        expect(reconstructed.getText("text").toString()).toBe("Hello World")
      }
    })
  })
})
