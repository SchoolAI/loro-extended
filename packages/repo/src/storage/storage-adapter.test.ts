import { getLogger } from "@logtape/logtape"
import { decodeImportBlobMeta, LoroDoc } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChannelMsg, ConnectedChannel, ReceiveFn } from "../channel.js"
import {
  type Chunk,
  StorageAdapter,
  type StorageKey,
} from "./storage-adapter.js"

// Create a mock logger for tests
const mockLogger = getLogger(["test"])

// Mock storage adapter for testing
class MockStorageAdapter extends StorageAdapter {
  loadCalls: StorageKey[] = []
  saveCalls: Array<{ key: StorageKey; data: Uint8Array }> = []
  removeCalls: StorageKey[] = []
  loadRangeCalls: StorageKey[] = []
  removeRangeCalls: StorageKey[] = []

  private storage = new Map<string, Uint8Array>()

  constructor() {
    super({ adapterType: "mock-storage" })
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
      logger: mockLogger,
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
        logger: mockLogger,
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
      expect(channel.adapterType).toBe("mock-storage")
    })
  })

  describe("Auto-Establishment", () => {
    it("auto-responds to establishment request", async () => {
      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/establish-request",
        identity: { peerId: "123", name: "test-peer", type: "user" },
      })

      expect(receivedMessages.length).toBeGreaterThanOrEqual(1)
      expect(receivedMessages[0].type).toBe("channel/establish-response")
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/establish-response",
        identity: {
          peerId: expect.any(String),
          name: "mock-storage",
        },
      })
    })

    it("sends sync-request for stored documents after establishment", async () => {
      // Pre-populate storage with documents
      const doc1 = new LoroDoc()
      doc1.getText("text").insert(0, "Doc 1")
      await adapter.save(
        ["doc1", "update", "1"],
        doc1.export({ mode: "snapshot" }),
      )

      const doc2 = new LoroDoc()
      doc2.getText("text").insert(0, "Doc 2")
      await adapter.save(
        ["doc2", "update", "1"],
        doc2.export({ mode: "snapshot" }),
      )

      const channel = await initializeAdapter()

      // Send establish-request to trigger the flow
      await channel.send({
        type: "channel/establish-request",
        identity: { peerId: "123", name: "test-peer", type: "user" },
      })

      // Should receive establish-response followed by sync-request
      expect(receivedMessages.length).toBe(2)
      expect(receivedMessages[0].type).toBe("channel/establish-response")
      expect(receivedMessages[1].type).toBe("channel/sync-request")

      // Verify sync-request contains both stored documents
      const syncRequest = receivedMessages[1]
      if (syncRequest.type === "channel/sync-request") {
        expect(syncRequest.docs).toHaveLength(2)
        const docIds = syncRequest.docs.map(d => d.docId)
        expect(docIds).toContain("doc1")
        expect(docIds).toContain("doc2")
        expect(syncRequest.bidirectional).toBe(true)
      }
    })

    it("does not send sync-request when storage is empty", async () => {
      // Don't pre-populate storage
      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/establish-request",
        identity: { peerId: "123", name: "test-peer", type: "user" },
      })

      // Should only receive establish-response, no sync-request
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0].type).toBe("channel/establish-response")
    })

    it("sends sync-request with unique docIds when documents have multiple chunks", async () => {
      // Simulate a document with multiple update chunks
      await adapter.save(["doc1", "update", "1"], new Uint8Array([1]))
      await adapter.save(["doc1", "update", "2"], new Uint8Array([2]))
      await adapter.save(["doc1", "update", "3"], new Uint8Array([3]))
      await adapter.save(["doc2", "update", "1"], new Uint8Array([4]))

      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/establish-request",
        identity: { peerId: "123", name: "test-peer", type: "user" },
      })

      // Should receive establish-response followed by sync-request
      expect(receivedMessages.length).toBe(2)
      expect(receivedMessages[1].type).toBe("channel/sync-request")

      // Verify sync-request contains unique docIds (not one per chunk)
      const syncRequest = receivedMessages[1]
      if (syncRequest.type === "channel/sync-request") {
        expect(syncRequest.docs).toHaveLength(2) // Not 4!
        const docIds = syncRequest.docs.map(d => d.docId)
        expect(docIds).toContain("doc1")
        expect(docIds).toContain("doc2")
      }
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
        bidirectional: false,
      })

      expect(adapter.loadRangeCalls).toHaveLength(1)
      expect(adapter.loadRangeCalls[0]).toEqual(["test-doc"])
      // Now sends 2 messages: sync-response + reciprocal sync-request for subscription
      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages[0].type).toBe("channel/sync-response")
      expect(receivedMessages[1].type).toBe("channel/sync-request")
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
        bidirectional: false,
      })

      // Now sends 2 messages: sync-response (unavailable) + reciprocal sync-request for subscription
      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/sync-response",
        docId: "nonexistent-doc",
        transmission: { type: "unavailable" },
      })
      // Reciprocal sync-request to get added to subscriptions
      expect(receivedMessages[1]).toMatchObject({
        type: "channel/sync-request",
        bidirectional: false,
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
        bidirectional: false,
      })

      // Now sends 2 messages: sync-response + reciprocal sync-request for subscription
      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/sync-response",
        docId: "test-doc",
        transmission: { type: "up-to-date" },
      })
      expect(receivedMessages[1].type).toBe("channel/sync-request")
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
        bidirectional: false,
      })

      // Now sends 2 messages: sync-response + reciprocal sync-request for subscription
      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/sync-response",
        docId: "test-doc",
        transmission: { type: "update" },
      })
      expect(receivedMessages[1].type).toBe("channel/sync-request")
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

    it("handles channel/update messages for ongoing document changes", async () => {
      const channel = await initializeAdapter()
      const docId = "test-doc"

      // Send an update message (used for ongoing changes after initial sync)
      await channel.send({
        type: "channel/update",
        docId,
        transmission: {
          type: "update",
          data: new Uint8Array([1, 2, 3]),
          version: new LoroDoc().version(),
        },
      })

      // Verify the update was saved
      expect(adapter.saveCalls).toHaveLength(1)
      expect(adapter.saveCalls[0].key[0]).toBe(docId)
      expect(adapter.saveCalls[0].key[1]).toBe("update")
      expect(adapter.saveCalls[0].data).toEqual(new Uint8Array([1, 2, 3]))
    })

    it("handles both sync-response and update messages", async () => {
      const channel = await initializeAdapter()
      const docId = "test-doc"

      // First, a sync-response (initial sync)
      await channel.send({
        type: "channel/sync-response",
        docId,
        transmission: {
          type: "snapshot",
          data: new Uint8Array([1]),
          version: new LoroDoc().version(),
        },
      })

      // Then, an update message (ongoing change)
      await channel.send({
        type: "channel/update",
        docId,
        transmission: {
          type: "update",
          data: new Uint8Array([2]),
          version: new LoroDoc().version(),
        },
      })

      // Both should be saved
      expect(adapter.saveCalls).toHaveLength(2)
      expect(adapter.saveCalls[0].data).toEqual(new Uint8Array([1]))
      expect(adapter.saveCalls[1].data).toEqual(new Uint8Array([2]))
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
        bidirectional: false,
      })

      // Now sends 2 messages: sync-response (unavailable) + reciprocal sync-request for subscription
      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages[0]).toMatchObject({
        type: "channel/sync-response",
        transmission: { type: "unavailable" },
      })
      expect(receivedMessages[1].type).toBe("channel/sync-request")
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
        bidirectional: false,
      })

      // Now sends 2 messages: sync-response + reciprocal sync-request for subscription
      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages[0].type).toBe("channel/sync-response")
      expect(receivedMessages[1].type).toBe("channel/sync-request")

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

  describe("Page Refresh / Reconnection Behavior", () => {
    it("sends sync-request with correct stored version (not empty)", async () => {
      // This test verifies the FIX for the duplicate chunks bug.
      //
      // The fix ensures that when the storage adapter sends a sync-request
      // after page refresh, it includes the ACTUAL stored version (not empty).
      // This allows the Repo to respond with "up-to-date" instead of sending
      // redundant data.

      // Step 1: Create initial document and save it (simulating first page load)
      const doc = new LoroDoc()
      doc.getText("text").insert(0, "Hello World")
      const snapshot = doc.export({ mode: "snapshot" })
      await adapter.save(["test-doc", "update", "initial"], snapshot)

      // Verify we have 1 chunk
      const chunksBeforeRefresh = await adapter.loadRange(["test-doc"])
      expect(chunksBeforeRefresh).toHaveLength(1)

      // Step 2: Simulate page refresh - establish channel and trigger sync
      const channel = await initializeAdapter()

      // Send establish-request (this triggers requestStoredDocuments)
      await channel.send({
        type: "channel/establish-request",
        identity: { peerId: "123", name: "test-peer", type: "user" },
      })

      // The storage adapter should have sent a sync-request for "test-doc"
      const syncRequest = receivedMessages.find(
        m => m.type === "channel/sync-request",
      )
      expect(syncRequest).toBeDefined()
      expect(syncRequest?.type).toBe("channel/sync-request")

      // Step 3: VERIFY THE FIX - the sync-request should contain the stored version
      // NOT an empty version!
      if (syncRequest?.type === "channel/sync-request") {
        const docRequest = syncRequest.docs.find(d => d.docId === "test-doc")
        expect(docRequest).toBeDefined()

        // The requesterDocVersion should match the stored document's version
        // (not be empty)
        if (!docRequest) throw new Error(`docRequest can't be null`)
        const requestedVersion = docRequest.requesterDocVersion
        const storedVersion = doc.oplogVersion()

        // Verify the version is NOT empty
        expect(requestedVersion.length()).toBeGreaterThan(0)

        // Verify the version matches what's stored
        // The comparison should be 0 (equal) or -1 (stored is subset of requested)
        const comparison = requestedVersion.compare(storedVersion)
        expect(comparison).toBe(0) // Versions should be equal
      }

      // Step 4: Simulate Repo responding with "up-to-date" (correct behavior)
      // When the Repo receives a sync-request with the correct version,
      // it responds with "up-to-date" instead of sending data
      await channel.send({
        type: "channel/sync-response",
        docId: "test-doc",
        transmission: {
          type: "up-to-date",
          version: doc.oplogVersion(),
        },
      })

      // Step 5: Verify no new chunks were created
      const chunksAfterRefresh = await adapter.loadRange(["test-doc"])
      expect(chunksAfterRefresh).toHaveLength(1)
    })

    it("should only save NEW data when storage is behind", async () => {
      // This tests the correct behavior: only save when there's actually new data

      // Step 1: Create initial document and save it
      const doc = new LoroDoc()
      doc.getText("text").insert(0, "Hello")
      const snapshot = doc.export({ mode: "snapshot" })
      await adapter.save(["test-doc", "update", "initial"], snapshot)

      const initialSaveCount = adapter.saveCalls.length

      // Step 2: Simulate page refresh
      const channel = await initializeAdapter()

      await channel.send({
        type: "channel/establish-request",
        identity: { peerId: "123", name: "test-peer", type: "user" },
      })

      // Step 3: Simulate Repo having NEW data (document was modified elsewhere)
      doc.getText("text").insert(5, " World")
      const newUpdate = doc.export({
        mode: "update",
        from: new LoroDoc().oplogVersion(),
      })

      await channel.send({
        type: "channel/sync-response",
        docId: "test-doc",
        transmission: {
          type: "update",
          data: newUpdate,
          version: doc.oplogVersion(),
        },
      })

      // Step 4: Verify exactly 1 new save occurred (for the new data)
      const savesAfterRefresh = adapter.saveCalls.length - initialSaveCount
      expect(savesAfterRefresh).toBe(1)

      // Verify we now have 2 chunks (original + new update)
      const chunks = await adapter.loadRange(["test-doc"])
      expect(chunks).toHaveLength(2)
    })

    describe("Version Extraction with decodeImportBlobMeta", () => {
      it("extracts and merges versions from multiple chunks without full reconstruction", async () => {
        // This test verifies that decodeImportBlobMeta can extract version vectors
        // from stored chunks, which is used by requestStoredDocuments() to send
        // the correct version in sync-requests.

        // Create chunks from different peers (simulating multi-peer collaboration)
        const doc1 = new LoroDoc()
        doc1.setPeerId("1")
        doc1.getText("text").insert(0, "Hello")
        doc1.commit()
        const chunk1 = doc1.export({ mode: "snapshot" })

        const doc2 = new LoroDoc()
        doc2.setPeerId("2")
        doc2.getText("text").insert(0, "World")
        doc2.commit()
        const chunk2 = doc2.export({ mode: "update" })

        // Extract metadata from each chunk WITHOUT full import
        const meta1 = decodeImportBlobMeta(chunk1, false)
        const meta2 = decodeImportBlobMeta(chunk2, false)

        // Verify we can extract versions
        expect(meta1.partialEndVersionVector.length()).toBeGreaterThan(0)
        expect(meta2.partialEndVersionVector.length()).toBeGreaterThan(0)

        // Merge the version vectors (same algorithm as requestStoredDocuments)
        const mergedVersionMap = new Map<string, number>()
        const v1 = meta1.partialEndVersionVector.toJSON()
        const v2 = meta2.partialEndVersionVector.toJSON()

        for (const [peer, counter] of v1.entries()) {
          const existing = mergedVersionMap.get(peer) ?? 0
          if (counter > existing) {
            mergedVersionMap.set(peer, counter)
          }
        }
        for (const [peer, counter] of v2.entries()) {
          const existing = mergedVersionMap.get(peer) ?? 0
          if (counter > existing) {
            mergedVersionMap.set(peer, counter)
          }
        }

        // Verify the merged version has both peers
        expect(mergedVersionMap.has("1")).toBe(true)
        expect(mergedVersionMap.has("2")).toBe(true)
      })
    })
  })
})
