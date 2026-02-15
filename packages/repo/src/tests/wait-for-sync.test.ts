/**
 * Tests for waitForSync() - the improved sync waiting API
 *
 * waitForSync() resolves when we've completed the sync handshake with a peer:
 * - Received document data (peer state = "loaded")
 * - Peer confirmed it doesn't have the document (peer state = "absent")
 *
 * This enables the common "initializeIfEmpty" pattern:
 * ```typescript
 * await sync(doc).waitForSync()
 * if (sync(doc).loroDoc.opCount() === 0) {
 *   initializeDocument(doc)
 * }
 * ```
 */

import { change, Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DelayedNetworkAdapter } from "../adapter/delayed-network-adapter.js"
import { Repo } from "../repo.js"
import { InMemoryStorageAdapter } from "../storage/in-memory-storage-adapter.js"
import { sync } from "../sync.js"
import { NoAdaptersError, SyncTimeoutError } from "../sync-errors.js"

const DocSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
})

describe("waitForSync", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("happy path - server has data", () => {
    it("should resolve when server sends document data", async () => {
      // Create a server repo with a document that has data
      const serverRepo = new Repo({
        identity: { name: "server", type: "service" },
      })
      const serverDoc = serverRepo.get("test-doc", DocSchema)
      change(serverDoc, draft => {
        draft.title.insert(0, "Server Data")
        draft.count.increment(42)
      })
      const serverSnapshot = sync(serverDoc).loroDoc.export({
        mode: "snapshot",
      })

      // Create client with delayed network adapter
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      // Get the document
      const clientDoc = clientRepo.get("test-doc", DocSchema)

      // At this point, the channel is established but no sync-response has arrived
      expect(sync(clientDoc).loroDoc.opCount()).toBe(0)

      // Track when waitForSync resolves
      let waitResolved = false
      const waitPromise = sync(clientDoc)
        .waitForSync({ timeout: 0 })
        .then(() => {
          waitResolved = true
        })

      // Advance time a bit, but not enough for sync-response
      await vi.advanceTimersByTimeAsync(50)

      // waitForSync should NOT have resolved yet
      expect(waitResolved).toBe(false)
      expect(sync(clientDoc).loroDoc.opCount()).toBe(0)

      // Now deliver the sync-response from the server
      const deliveryPromise = adapter.deliverSyncResponse(
        "test-doc",
        serverSnapshot,
      )
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise

      // Now waitForSync should resolve
      await vi.runAllTimersAsync()
      await waitPromise

      expect(waitResolved).toBe(true)
      // And the document should have the server's data
      expect(clientDoc.toJSON().title).toBe("Server Data")
      expect(clientDoc.toJSON().count).toBe(42)
    }, 1000)
  })

  describe("server confirms document unavailable", () => {
    it("should resolve when server confirms document unavailable", async () => {
      // Create client with delayed network adapter
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      // Get a document that doesn't exist on the server
      const clientDoc = clientRepo.get("nonexistent-doc", DocSchema)

      // Start waiting for sync
      let waitResolved = false
      const _waitPromise = sync(clientDoc)
        .waitForSync({ timeout: 0 })
        .then(() => {
          waitResolved = true
        })

      // Advance time a bit
      await vi.advanceTimersByTimeAsync(50)

      // waitForSync should NOT have resolved yet
      expect(waitResolved).toBe(false)

      // Server responds that it doesn't have the document
      const deliveryPromise = adapter.deliverUnavailable("nonexistent-doc")
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise

      // Give it more time
      await vi.advanceTimersByTimeAsync(100)

      // waitForSync should have resolved because the server confirmed
      // it doesn't have the document (state="absent")
      expect(waitResolved).toBe(true)
    }, 1000)
  })

  describe("timeout behavior", () => {
    it("should throw SyncTimeoutError when timeout expires", async () => {
      // Use real timers for this test to avoid fake timer race conditions
      vi.useRealTimers()

      // Create client with delayed network adapter that never delivers
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 10_000 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientDoc = clientRepo.get("test-doc", DocSchema)

      // Should throw SyncTimeoutError with a short real timeout
      await expect(
        sync(clientDoc).waitForSync({ timeout: 50 }),
      ).rejects.toThrow(SyncTimeoutError)

      // Cleanup
      clientRepo.synchronizer.stopHeartbeat()

      // Restore fake timers for other tests
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    }, 5000)

    it("should include diagnostic information in timeout error", async () => {
      // Use real timers for this test to avoid fake timer race conditions
      vi.useRealTimers()

      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 10_000 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientDoc = clientRepo.get("test-doc", DocSchema)

      try {
        await sync(clientDoc).waitForSync({ timeout: 50 })
        expect.fail("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(SyncTimeoutError)
        const syncError = error as SyncTimeoutError
        expect(syncError.kind).toBe("network")
        expect(syncError.timeoutMs).toBe(50)
        expect(syncError.docId).toBe("test-doc")
      }

      // Cleanup
      clientRepo.synchronizer.stopHeartbeat()

      // Restore fake timers for other tests
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    }, 5000)
  })

  describe("no adapters configured", () => {
    it("should throw NoAdaptersError when no network adapters", async () => {
      // Create client with NO adapters
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [],
      })

      const clientDoc = clientRepo.get("test-doc", DocSchema)

      // Should throw immediately (no network adapters)
      await expect(
        sync(clientDoc).waitForSync({ kind: "network" }),
      ).rejects.toThrow(NoAdaptersError)
    }, 1000)

    it("should throw NoAdaptersError when no storage adapters", async () => {
      // Create client with only network adapter, no storage
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientDoc = clientRepo.get("test-doc", DocSchema)

      // Should throw immediately (no storage adapters)
      await expect(
        sync(clientDoc).waitForSync({ kind: "storage" }),
      ).rejects.toThrow(NoAdaptersError)
    }, 1000)
  })

  describe("storage sync", () => {
    it("should resolve when storage has data", async () => {
      // Create a storage adapter with some data
      const storageData = new Map<string, Uint8Array>()

      // First, create a document and save it to storage
      const storage1 = new InMemoryStorageAdapter({ sharedData: storageData })
      const repo1 = new Repo({
        identity: { name: "writer", type: "user" },
        adapters: [storage1],
      })

      const doc1 = repo1.get("test-doc", DocSchema)
      change(doc1, draft => {
        draft.title.insert(0, "Stored Data")
      })

      // Wait for storage to save
      await vi.runAllTimersAsync()

      // Now create a second repo that loads from the same storage
      const storage2 = new InMemoryStorageAdapter({ sharedData: storageData })
      const repo2 = new Repo({
        identity: { name: "reader", type: "user" },
        adapters: [storage2],
      })

      const doc2 = repo2.get("test-doc", DocSchema)

      // Wait for storage sync
      await sync(doc2).waitForSync({ kind: "storage", timeout: 0 })

      // Advance timers to allow storage to load
      await vi.runAllTimersAsync()

      // Document should have the stored data
      expect(doc2.toJSON().title).toBe("Stored Data")
    }, 1000)
  })

  describe("abort signal", () => {
    it("should abort when signal is triggered", async () => {
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 10_000 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientDoc = clientRepo.get("test-doc", DocSchema)

      const controller = new AbortController()
      const waitPromise = sync(clientDoc).waitForSync({
        timeout: 0,
        signal: controller.signal,
      })

      // Abort after a short delay
      await vi.advanceTimersByTimeAsync(50)
      controller.abort()

      // Should throw DOMException with name "AbortError"
      await expect(waitPromise).rejects.toThrow()

      // Cleanup
      clientRepo.synchronizer.stopHeartbeat()
    }, 1000)
  })

  describe("multiple waitForSync calls", () => {
    it("should support multiple concurrent waitForSync calls", async () => {
      // Create a server repo with a document
      const serverRepo = new Repo({
        identity: { name: "server", type: "service" },
      })
      const serverDoc = serverRepo.get("test-doc", DocSchema)
      change(serverDoc, draft => {
        draft.title.insert(0, "Server Data")
      })
      const serverSnapshot = sync(serverDoc).loroDoc.export({
        mode: "snapshot",
      })

      // Create client
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientDoc = clientRepo.get("test-doc", DocSchema)

      // Start multiple waitForSync calls
      const wait1 = sync(clientDoc).waitForSync({ timeout: 0 })
      const wait2 = sync(clientDoc).waitForSync({ timeout: 0 })
      const wait3 = sync(clientDoc).waitForSync({ timeout: 0 })

      // Deliver the sync response
      const deliveryPromise = adapter.deliverSyncResponse(
        "test-doc",
        serverSnapshot,
      )
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise
      await vi.runAllTimersAsync()

      // All should resolve
      await expect(wait1).resolves.toBeUndefined()
      await expect(wait2).resolves.toBeUndefined()
      await expect(wait3).resolves.toBeUndefined()
    }, 1000)
  })

  describe("initializeIfEmpty pattern", () => {
    it("should enable safe initialize-if-empty pattern with server data", async () => {
      // Server has data
      const serverRepo = new Repo({
        identity: { name: "server", type: "service" },
      })
      const serverDoc = serverRepo.get("test-doc", DocSchema)
      change(serverDoc, draft => {
        draft.title.insert(0, "Existing Data")
        draft.count.increment(100)
      })
      const serverSnapshot = sync(serverDoc).loroDoc.export({
        mode: "snapshot",
      })

      // Client creates document
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientDoc = clientRepo.get("test-doc", DocSchema)

      // Deliver server data
      const deliveryPromise = adapter.deliverSyncResponse(
        "test-doc",
        serverSnapshot,
      )
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise

      // Wait for sync
      await sync(clientDoc).waitForSync({ timeout: 0 })
      await vi.runAllTimersAsync()

      // Now do the "initializeIfEmpty" check
      if (sync(clientDoc).loroDoc.opCount() === 0) {
        // This should NOT run because server had data
        change(clientDoc, draft => {
          draft.title.insert(0, "Default Title")
          draft.count.increment(1)
        })
      }

      // Should have server's data, not default
      expect(clientDoc.toJSON().title).toBe("Existing Data")
      expect(clientDoc.toJSON().count).toBe(100)
    }, 1000)

    it("should enable safe initialize-if-empty pattern with no server data", async () => {
      // Client creates document, server confirms it doesn't exist
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientDoc = clientRepo.get("new-doc", DocSchema)

      // Server confirms document doesn't exist
      const deliveryPromise = adapter.deliverUnavailable("new-doc")
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise

      // Wait for sync
      await sync(clientDoc).waitForSync({ timeout: 0 })
      await vi.runAllTimersAsync()

      // Now do the "initializeIfEmpty" check
      if (sync(clientDoc).loroDoc.opCount() === 0) {
        // This SHOULD run because server confirmed no data
        change(clientDoc, draft => {
          draft.title.insert(0, "Default Title")
          draft.count.increment(1)
        })
      }

      // Should have default data
      expect(clientDoc.toJSON().title).toBe("Default Title")
      expect(clientDoc.toJSON().count).toBe(1)
    }, 1000)
  })
})
