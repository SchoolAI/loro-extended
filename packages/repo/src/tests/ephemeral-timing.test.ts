import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"

/**
 * Tests for ephemeral/presence timing issues.
 *
 * These tests simulate real-world timing scenarios where:
 * - Presence is set immediately after connection
 * - Multiple clients connect at different times
 * - Network delays affect message ordering
 *
 * Note: We use real timers because EphemeralStore from loro-crdt uses internal
 * timers that conflict with vitest's fake timers.
 */
describe("Ephemeral Store - Timing Issues", () => {
  let serverBridgeToA: Bridge
  let serverBridgeToB: Bridge
  let server: Repo
  let clientA: Repo
  let clientB: Repo

  // Helper to wait for async operations
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  beforeEach(() => {
    serverBridgeToA = new Bridge()
    serverBridgeToB = new Bridge()

    server = new Repo({
      identity: { name: "server", type: "service" },
      adapters: [
        new BridgeAdapter({
          bridge: serverBridgeToA,
          adapterId: "server-to-a",
        }),
        new BridgeAdapter({
          bridge: serverBridgeToB,
          adapterId: "server-to-b",
        }),
      ],
    })

    clientA = new Repo({
      identity: { name: "clientA", type: "user" },
      adapters: [
        new BridgeAdapter({
          bridge: serverBridgeToA,
          adapterId: "clientA-adapter",
        }),
      ],
    })

    clientB = new Repo({
      identity: { name: "clientB", type: "user" },
      adapters: [
        new BridgeAdapter({
          bridge: serverBridgeToB,
          adapterId: "clientB-adapter",
        }),
      ],
    })
  })

  afterEach(() => {
    server.synchronizer.stopHeartbeat()
    clientA.synchronizer.stopHeartbeat()
    clientB.synchronizer.stopHeartbeat()
  })

  describe("Immediate presence setting", () => {
    it("should handle presence set immediately after getting handle", async () => {
      const docId = "immediate-presence-doc"

      // Simulate what React does: get handle and immediately set presence
      const handleA = clientA.get(docId)
      handleA.untypedPresence.set({ type: "user", name: "Alice" })

      const handleB = clientB.get(docId)
      handleB.untypedPresence.set({ type: "user", name: "Bob" })

      server.get(docId)

      // Wait for everything to sync
      await wait(300)

      const peerIdA = clientA.identity.peerId
      const peerIdB = clientB.identity.peerId

      // Both clients should see each other
      expect(handleA.untypedPresence.all[peerIdB]).toEqual({
        type: "user",
        name: "Bob",
      })
      expect(handleB.untypedPresence.all[peerIdA]).toEqual({
        type: "user",
        name: "Alice",
      })
    })

    it("should handle presence set before sync completes", async () => {
      const docId = "pre-sync-presence-doc"

      // ClientA gets handle and sets presence immediately (before sync)
      const handleA = clientA.get(docId)
      handleA.untypedPresence.set({ status: "connecting" })

      // Small delay
      await wait(10)

      // ClientB connects
      const handleB = clientB.get(docId)
      handleB.untypedPresence.set({ status: "connecting" })

      server.get(docId)

      // Wait for sync
      await wait(300)

      const peerIdA = clientA.identity.peerId
      const peerIdB = clientB.identity.peerId

      // Both should see each other
      expect(handleA.untypedPresence.all[peerIdB]).toEqual({
        status: "connecting",
      })
      expect(handleB.untypedPresence.all[peerIdA]).toEqual({
        status: "connecting",
      })
    })

    it("should handle rapid presence updates", async () => {
      const docId = "rapid-updates-doc"

      const handleA = clientA.get(docId)
      const handleB = clientB.get(docId)
      server.get(docId)

      // Wait for initial connection
      await wait(200)

      // Rapid updates from clientA - each should trigger a broadcast
      handleA.untypedPresence.set({ count: 1 })
      await wait(50) // Small delay between updates
      handleA.untypedPresence.set({ count: 2 })
      await wait(50)
      handleA.untypedPresence.set({ count: 3 })

      // Wait for propagation
      await wait(200)

      const peerIdA = clientA.identity.peerId

      // ClientB should see the final value
      expect(handleB.untypedPresence.all[peerIdA]).toEqual({ count: 3 })
    })
  })

  describe("Staggered connection timing", () => {
    it("should propagate presence when second client connects later", async () => {
      const docId = "staggered-connection-doc"

      // ClientA connects first and sets presence
      const handleA = clientA.get(docId)
      server.get(docId)

      await wait(100)

      handleA.untypedPresence.set({ early: true })

      await wait(100)

      // ClientB connects later
      const handleB = clientB.get(docId)

      await wait(200)

      const peerIdA = clientA.identity.peerId

      // ClientB should have received ClientA's presence
      expect(handleB.untypedPresence.all[peerIdA]).toEqual({ early: true })
    })

    it("should propagate presence from late joiner to early joiner", async () => {
      const docId = "late-to-early-doc"

      // ClientA connects first
      const handleA = clientA.get(docId)
      server.get(docId)

      await wait(100)

      handleA.untypedPresence.set({ first: true })

      await wait(100)

      // ClientB connects and sets presence
      const handleB = clientB.get(docId)
      handleB.untypedPresence.set({ second: true })

      await wait(200)

      const peerIdA = clientA.identity.peerId
      const peerIdB = clientB.identity.peerId

      // Both should see each other
      expect(handleA.untypedPresence.all[peerIdB]).toEqual({ second: true })
      expect(handleB.untypedPresence.all[peerIdA]).toEqual({ first: true })
    })
  })

  describe("Subscription verification", () => {
    it("should verify server has correct subscriptions", async () => {
      const docId = "subscription-check-doc"

      server.get(docId)

      await wait(200)

      const peerIdA = clientA.identity.peerId
      const peerIdB = clientB.identity.peerId

      // Check server's peer state
      const peerStateA = server.synchronizer.model.peers.get(peerIdA)
      const peerStateB = server.synchronizer.model.peers.get(peerIdB)

      expect(peerStateA).toBeDefined()
      expect(peerStateB).toBeDefined()
      expect(peerStateA?.subscriptions.has(docId)).toBe(true)
      expect(peerStateB?.subscriptions.has(docId)).toBe(true)
    })
    describe("Late Joiner Presence Visibility", () => {
      it("should propagate presence set BEFORE sync completes (React pattern)", async () => {
        /**
         * This test simulates what happens in a React app:
         * 1. Component mounts and immediately calls setSelf()
         * 2. This happens BEFORE the sync-request/response completes
         * 3. The broadcast goes to 0 peers because no channels are established yet
         * 4. When sync completes, the server should still notify existing clients
         */
        const docId = "react-pattern-doc"

        // Client A connects first and sets presence
        const handleA = clientA.get(docId)
        server.get(docId)

        await wait(100)

        handleA.untypedPresence.set({ type: "user", name: "Alice" })

        await wait(100)

        // Now simulate what React does: create client B and IMMEDIATELY set presence
        // before waiting for sync to complete
        clientB = new Repo({
          identity: { name: "clientB", type: "user" },
          adapters: [
            new BridgeAdapter({
              bridge: serverBridgeToB,
              adapterId: "clientB-adapter",
            }),
          ],
        })

        const handleB = clientB.get(docId)

        // Set presence IMMEDIATELY - before sync completes
        // This is what React's useEffect does
        handleB.untypedPresence.set({ type: "user", name: "Bob" })

        // Wait for sync to complete and presence to propagate
        // Using 500ms which is much less than the 10s heartbeat
        await wait(500)

        const peerIdA = clientA.identity.peerId
        const peerIdB = clientB.identity.peerId

        // Client B should see Client A's presence (server sends it during sync)
        const clientBPresenceOfA = handleB.untypedPresence.all[peerIdA]
        expect(clientBPresenceOfA).toBeDefined()
        expect((clientBPresenceOfA as Record<string, unknown>)?.name).toBe(
          "Alice",
        )

        // THIS IS THE KEY ASSERTION:
        // Client A should see Client B's presence even though B set it before sync completed
        const clientAPresenceOfB = handleA.untypedPresence.all[peerIdB]
        expect(clientAPresenceOfB).toBeDefined()
        expect((clientAPresenceOfB as Record<string, unknown>)?.name).toBe(
          "Bob",
        )
      })
    })
  })
})
