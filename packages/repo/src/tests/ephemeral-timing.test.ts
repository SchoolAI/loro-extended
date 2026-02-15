import { Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"

/**
 * Tests for ephemeral/presence timing scenarios.
 *
 * These tests verify that presence data is correctly propagated in various
 * real-world timing scenarios:
 * - Presence set immediately after connection (React useEffect pattern)
 * - Multiple clients connecting at different times
 * - Late joiners receiving existing presence
 *
 * Note: We use real timers because EphemeralStore from loro-crdt uses internal
 * timers that conflict with vitest's fake timers.
 */

// Document schema
const DocSchema = Shape.doc({
  content: Shape.text(),
})

// Presence schema
const PresenceSchema = Shape.plain.struct({
  status: Shape.plain.string(),
})

describe("Ephemeral Store - Timing Issues", () => {
  let bridge: Bridge
  let clientA: Repo
  let clientB: Repo

  // Helper to wait for async operations
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  beforeEach(() => {
    bridge = new Bridge()

    clientA = new Repo({
      identity: { name: "clientA", type: "user", peerId: "1" as `${number}` },
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "clientA-adapter",
        }),
      ],
    })

    clientB = new Repo({
      identity: { name: "clientB", type: "user", peerId: "2" as `${number}` },
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "clientB-adapter",
        }),
      ],
    })
  })

  afterEach(() => {
    clientA.synchronizer.stopHeartbeat()
    clientB.synchronizer.stopHeartbeat()
  })

  describe("Immediate presence setting", () => {
    it("should handle presence set immediately after getting handle", async () => {
      const docId = "immediate-presence-doc"

      // Wait for connection
      await wait(100)

      // Simulate what React does: get handle and immediately set presence
      const handleA = clientA.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })
      handleA.presence.setSelf({ status: "online-A" })

      const handleB = clientB.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })
      handleB.presence.setSelf({ status: "online-B" })

      // Wait for everything to sync
      await wait(200)

      // Both clients should see each other
      expect(handleA.presence.get("2")?.status).toBe("online-B")
      expect(handleB.presence.get("1")?.status).toBe("online-A")
    })

    it("should handle presence set before sync completes", async () => {
      const docId = "pre-sync-presence-doc"

      // Wait for connection
      await wait(100)

      // ClientA gets handle and sets presence immediately (before sync)
      const handleA = clientA.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })
      handleA.presence.setSelf({ status: "connecting" })

      // Small delay
      await wait(10)

      // ClientB connects
      const handleB = clientB.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })
      handleB.presence.setSelf({ status: "connecting" })

      // Wait for sync
      await wait(200)

      // Both should see each other
      expect(handleA.presence.get("2")?.status).toBe("connecting")
      expect(handleB.presence.get("1")?.status).toBe("connecting")
    })

    it("should handle rapid presence updates", async () => {
      const docId = "rapid-updates-doc"

      // Wait for connection
      await wait(100)

      const handleA = clientA.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })
      const handleB = clientB.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })

      // Wait for initial connection
      await wait(100)

      // Rapid updates from clientA - each should trigger a broadcast
      handleA.presence.setSelf({ status: "count-1" })
      await wait(50) // Small delay between updates
      handleA.presence.setSelf({ status: "count-2" })
      await wait(50)
      handleA.presence.setSelf({ status: "count-3" })

      // Wait for propagation
      await wait(200)

      // ClientB should see the final value
      expect(handleB.presence.get("1")?.status).toBe("count-3")
    })
  })

  describe("Staggered connection timing", () => {
    it("should propagate presence when second client connects later", async () => {
      const docId = "staggered-connection-doc"

      // Wait for connection
      await wait(100)

      // ClientA connects first and sets presence
      const handleA = clientA.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })

      await wait(50)

      handleA.presence.setSelf({ status: "early" })

      await wait(100)

      // ClientB connects later
      const handleB = clientB.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })

      await wait(200)

      // ClientB should have received ClientA's presence
      expect(handleB.presence.get("1")?.status).toBe("early")
    })

    it("should propagate presence from late joiner to early joiner", async () => {
      const docId = "late-to-early-doc"

      // Wait for connection
      await wait(100)

      // ClientA connects first
      const handleA = clientA.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })

      await wait(50)

      handleA.presence.setSelf({ status: "first" })

      await wait(100)

      // ClientB connects and sets presence
      const handleB = clientB.getHandle(docId, DocSchema, {
        presence: PresenceSchema,
      })
      handleB.presence.setSelf({ status: "second" })

      await wait(200)

      // Both should see each other
      expect(handleA.presence.get("2")?.status).toBe("second")
      expect(handleB.presence.get("1")?.status).toBe("first")
    })
  })

  describe("Subscription verification", () => {
    it("should verify peers have correct subscriptions", async () => {
      const docId = "subscription-check-doc"

      // Wait for connection
      await wait(100)

      clientA.getHandle(docId, DocSchema, { presence: PresenceSchema })
      clientB.getHandle(docId, DocSchema, { presence: PresenceSchema })

      await wait(200)

      // Check peer states
      const peerStateA = clientB.synchronizer.model.peers.get("1")
      const peerStateB = clientA.synchronizer.model.peers.get("2")

      expect(peerStateA).toBeDefined()
      expect(peerStateB).toBeDefined()
      expect(peerStateA?.subscriptions.has(docId)).toBe(true)
      expect(peerStateB?.subscriptions.has(docId)).toBe(true)
    })

    describe("Late Joiner Presence Visibility", () => {
      it("should propagate presence set BEFORE sync completes (React pattern)", async () => {
        /**
         * This test verifies the React useEffect pattern works correctly:
         * 1. Component mounts and immediately calls setSelf()
         * 2. Presence is broadcast to connected peers
         * 3. Peers receive presence immediately
         */
        const docId = "react-pattern-doc"

        // Wait for connection
        await wait(100)

        // Client A connects first and sets presence
        const handleA = clientA.getHandle(docId, DocSchema, {
          presence: PresenceSchema,
        })

        await wait(50)

        handleA.presence.setSelf({ status: "Alice" })

        await wait(100)

        // Now simulate what React does: get handle and IMMEDIATELY set presence
        const handleB = clientB.getHandle(docId, DocSchema, {
          presence: PresenceSchema,
        })

        // Set presence IMMEDIATELY - before sync completes
        // This is what React's useEffect does
        handleB.presence.setSelf({ status: "Bob" })

        // Wait for sync to complete and presence to propagate
        await wait(300)

        // Client B should see Client A's presence
        const clientBPresenceOfA = handleB.presence.get("1")
        expect(clientBPresenceOfA).toBeDefined()
        expect(clientBPresenceOfA?.status).toBe("Alice")

        // THIS IS THE KEY ASSERTION:
        // Client A should see Client B's presence even though B set it before sync completed
        const clientAPresenceOfB = handleA.presence.get("2")
        expect(clientAPresenceOfB).toBeDefined()
        expect(clientAPresenceOfB?.status).toBe("Bob")
      })
    })
  })
})
