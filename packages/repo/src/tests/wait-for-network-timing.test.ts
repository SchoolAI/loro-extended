/**
 * Tests for waitForSync() - the improved sync waiting API
 *
 * waitForSync() resolves when we've completed the sync handshake with a peer:
 * - Received document data (peer state = "loaded")
 * - Peer confirmed it doesn't have the document (peer state = "absent")
 *
 * This enables the common "initializeIfEmpty" pattern:
 * ```typescript
 * await handle.waitForSync()
 * if (handle.loroDoc.opCount() === 0) {
 *   initializeDocument(handle)
 * }
 * ```
 */

import { Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DelayedNetworkAdapter } from "../adapter/delayed-network-adapter.js"
import { NoAdaptersError, SyncTimeoutError } from "../handle.js"
import { Repo } from "../repo.js"

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
      const serverHandle = serverRepo.get("test-doc", DocSchema)
      serverHandle.change(draft => {
        draft.title.insert(0, "Server Data")
        draft.count.increment(42)
      })
      const serverSnapshot = serverHandle.loroDoc.export({ mode: "snapshot" })

      // Create client with delayed network adapter
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      // Get the document handle
      const clientHandle = clientRepo.get("test-doc", DocSchema)

      // At this point, the channel is established but no sync-response has arrived
      expect(clientHandle.loroDoc.opCount()).toBe(0)

      // Track when waitForSync resolves
      let waitResolved = false
      const waitPromise = clientHandle.waitForSync({ timeout: 0 }).then(() => {
        waitResolved = true
      })

      // Advance time a bit, but not enough for sync-response
      await vi.advanceTimersByTimeAsync(50)

      // waitForSync should NOT have resolved yet
      expect(waitResolved).toBe(false)
      expect(clientHandle.loroDoc.opCount()).toBe(0)

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
      expect(clientHandle.doc.toJSON().title).toBe("Server Data")
      expect(clientHandle.doc.toJSON().count).toBe(42)
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
      const clientHandle = clientRepo.get("nonexistent-doc", DocSchema)

      // Start waiting for sync
      let waitResolved = false
      const _waitPromise = clientHandle.waitForSync({ timeout: 0 }).then(() => {
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
    }, 500)
  })

  describe("initializeIfEmpty pattern", () => {
    it("should NOT initialize when server has data", async () => {
      // Create a server repo with existing data
      const serverRepo = new Repo({
        identity: { name: "server", type: "service" },
      })
      const serverHandle = serverRepo.get("existing-doc", DocSchema)
      serverHandle.change(draft => {
        draft.title.insert(0, "Existing Title")
      })
      const serverSnapshot = serverHandle.loroDoc.export({ mode: "snapshot" })

      // Create client
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientHandle = clientRepo.get("existing-doc", DocSchema)

      // The app's initialization pattern
      let initializationRan = false
      async function initializeIfEmpty() {
        await clientHandle.waitForSync({ timeout: 0 })

        // Only initialize if the document is empty AFTER network sync
        if (clientHandle.loroDoc.opCount() === 0) {
          initializationRan = true
          clientHandle.change(draft => {
            draft.title.insert(0, "Default Title")
          })
        }
      }

      // Start the initialization
      const initPromise = initializeIfEmpty()

      // Deliver the server's data
      const deliveryPromise = adapter.deliverSyncResponse(
        "existing-doc",
        serverSnapshot,
      )
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise

      await vi.runAllTimersAsync()
      await initPromise

      // The document should have the SERVER's data, not the default
      expect(clientHandle.doc.toJSON().title).toBe("Existing Title")

      // The initialization should NOT have run because the server had data
      expect(initializationRan).toBe(false)
    }, 1000)

    it("should initialize when server confirms document does not exist", async () => {
      // Create client
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientHandle = clientRepo.get("new-doc", DocSchema)

      // The app's initialization pattern
      let initializationRan = false
      let waitCompleted = false
      async function initializeIfEmpty() {
        await clientHandle.waitForSync({ timeout: 0 })
        waitCompleted = true

        // Only initialize if the document is empty AFTER network sync
        if (clientHandle.loroDoc.opCount() === 0) {
          initializationRan = true
          clientHandle.change(draft => {
            draft.title.insert(0, "Default Title")
          })
        }
      }

      // Start the initialization
      const _initPromise = initializeIfEmpty()

      // Server confirms it doesn't have the document
      const deliveryPromise = adapter.deliverUnavailable("new-doc")
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise

      // Give it more time
      await vi.advanceTimersByTimeAsync(200)

      // waitForSync completes when server confirms it doesn't have the doc
      expect(waitCompleted).toBe(true)
      expect(initializationRan).toBe(true)
      expect(clientHandle.doc.toJSON().title).toBe("Default Title")
    }, 500)
  })

  describe("error handling", () => {
    it("should throw NoAdaptersError when no network adapters configured", async () => {
      // Create client WITHOUT any adapters
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [], // No adapters!
      })

      const clientHandle = clientRepo.get("test-doc", DocSchema)

      // waitForSync should throw immediately
      await expect(
        clientHandle.waitForSync({ kind: "network" }),
      ).rejects.toThrow(NoAdaptersError)
    })

    it("should throw NoAdaptersError when no storage adapters configured", async () => {
      // Create client with only network adapter
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientHandle = clientRepo.get("test-doc", DocSchema)

      // waitForSync for storage should throw
      await expect(
        clientHandle.waitForSync({ kind: "storage" }),
      ).rejects.toThrow(NoAdaptersError)
    })

    it("should throw SyncTimeoutError when timeout is reached", async () => {
      // Use real timers for this test to avoid fake timer issues with promise rejections
      vi.useRealTimers()

      // Create client with delayed network adapter that never responds
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 10000 }) // Long delay
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientHandle = clientRepo.get("test-doc", DocSchema)

      // Start waiting with a very short timeout (50ms)
      // The adapter won't respond in time, so it should timeout
      try {
        await clientHandle.waitForSync({ timeout: 50 })
        expect.fail("Should have thrown SyncTimeoutError")
      } catch (error) {
        expect(error).toBeInstanceOf(SyncTimeoutError)
        const syncError = error as SyncTimeoutError
        // Verify enriched error context
        expect(syncError.kind).toBe("network")
        expect(syncError.timeoutMs).toBe(50)
        expect(syncError.docId).toBe("test-doc")
        // lastSeenStates may be undefined or an array
        expect(
          syncError.lastSeenStates === undefined ||
            Array.isArray(syncError.lastSeenStates),
        ).toBe(true)
      }

      // Restore fake timers for other tests
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    }, 1000)

    it("should throw NoAdaptersError with docId context", async () => {
      // Create client WITHOUT any adapters
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [],
      })

      const clientHandle = clientRepo.get("my-special-doc", DocSchema)

      try {
        await clientHandle.waitForSync({ kind: "network" })
        expect.fail("Should have thrown NoAdaptersError")
      } catch (error) {
        expect(error).toBeInstanceOf(NoAdaptersError)
        const noAdaptersError = error as NoAdaptersError
        expect(noAdaptersError.kind).toBe("network")
        expect(noAdaptersError.docId).toBe("my-special-doc")
        expect(noAdaptersError.message).toContain("my-special-doc")
      }
    })

    it("should NOT timeout when timeout is set to 0", async () => {
      // Create client with delayed network adapter
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientHandle = clientRepo.get("test-doc", DocSchema)

      // Start waiting with timeout disabled
      let resolved = false
      const waitPromise = clientHandle.waitForSync({ timeout: 0 }).then(() => {
        resolved = true
      })

      // Advance time way past what would be a normal timeout
      await vi.advanceTimersByTimeAsync(60_000)

      // Should NOT have resolved (no sync response yet) but also NOT thrown
      expect(resolved).toBe(false)

      // Now deliver the response
      const deliveryPromise = adapter.deliverUnavailable("test-doc")
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise

      await vi.runAllTimersAsync()
      await waitPromise

      expect(resolved).toBe(true)
    }, 1000)

    it("should abort when AbortSignal is triggered", async () => {
      // Use real timers for this test
      vi.useRealTimers()

      // Create client with delayed network adapter that never responds
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 10000 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientHandle = clientRepo.get("test-doc", DocSchema)

      // Create an AbortController
      const controller = new AbortController()

      // Start waiting with no timeout but with abort signal
      const waitPromise = clientHandle.waitForSync({
        timeout: 0,
        signal: controller.signal,
      })

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50)

      // Should throw AbortError
      try {
        await waitPromise
        expect.fail("Should have thrown AbortError")
      } catch (error) {
        expect(error).toBeInstanceOf(DOMException)
        expect((error as DOMException).name).toBe("AbortError")
      }

      // Restore fake timers
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    }, 1000)

    it("should reject immediately if signal is already aborted", async () => {
      // Create client with network adapter
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientHandle = clientRepo.get("test-doc", DocSchema)

      // Create an already-aborted signal
      const controller = new AbortController()
      controller.abort()

      // Should throw immediately with AbortError
      try {
        await clientHandle.waitForSync({ signal: controller.signal })
        expect.fail("Should have thrown AbortError")
      } catch (error) {
        expect(error).toBeInstanceOf(DOMException)
        expect((error as DOMException).name).toBe("AbortError")
      }
    })
  })

  describe("deprecated methods", () => {
    it("waitForNetwork should still work for loaded state", async () => {
      // Create a server repo with a document that has data
      const serverRepo = new Repo({
        identity: { name: "server", type: "service" },
      })
      const serverHandle = serverRepo.get("test-doc", DocSchema)
      serverHandle.change(draft => {
        draft.title.insert(0, "Server Data")
      })
      const serverSnapshot = serverHandle.loroDoc.export({ mode: "snapshot" })

      // Create client with delayed network adapter
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientHandle = clientRepo.get("test-doc", DocSchema)

      // Track when waitForNetwork resolves
      let waitResolved = false
      const waitPromise = clientHandle.waitForNetwork().then(() => {
        waitResolved = true
      })

      // Deliver the sync-response from the server
      const deliveryPromise = adapter.deliverSyncResponse(
        "test-doc",
        serverSnapshot,
      )
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise

      await vi.runAllTimersAsync()
      await waitPromise

      expect(waitResolved).toBe(true)
    }, 1000)

    it("waitForNetwork should NOT resolve for absent state (known limitation)", async () => {
      // This test documents the known limitation of the deprecated method
      const adapter = new DelayedNetworkAdapter({ syncResponseDelay: 100 })
      const clientRepo = new Repo({
        identity: { name: "client", type: "user" },
        adapters: [adapter],
      })

      const clientHandle = clientRepo.get("nonexistent-doc", DocSchema)

      let waitResolved = false
      clientHandle.waitForNetwork().then(() => {
        waitResolved = true
      })

      // Server responds that it doesn't have the document
      const deliveryPromise = adapter.deliverUnavailable("nonexistent-doc")
      await vi.advanceTimersByTimeAsync(100)
      await deliveryPromise

      await vi.advanceTimersByTimeAsync(200)

      // The deprecated method does NOT resolve for absent state
      // This is the bug that waitForSync fixes
      expect(waitResolved).toBe(false)
    }, 500)
  })
})
