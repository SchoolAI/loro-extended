import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "./adapter/bridge-adapter.js"
import { Repo } from "./repo.js"

/**
 * Tests for ephemeral/presence in a hub-and-spoke topology.
 *
 * Hub-and-spoke topology:
 * - Server (hub) connects to multiple clients (spokes)
 * - Clients don't connect directly to each other
 * - All communication goes through the server
 *
 * This is the typical deployment pattern for web apps where:
 * - Browser clients connect to a central server
 * - Server relays messages between clients
 */
describe("Ephemeral Store - Hub and Spoke Topology", () => {
  let serverBridgeToA: Bridge
  let serverBridgeToB: Bridge
  let server: Repo
  let clientA: Repo
  let clientB: Repo

  beforeEach(() => {
    // Create separate bridges for server-to-clientA and server-to-clientB
    // This simulates a hub-and-spoke topology where clients don't talk directly
    serverBridgeToA = new Bridge()
    serverBridgeToB = new Bridge()

    // Server connects to both bridges (hub)
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

    // Client A connects only to serverBridgeToA
    clientA = new Repo({
      identity: { name: "clientA", type: "user" },
      adapters: [
        new BridgeAdapter({
          bridge: serverBridgeToA,
          adapterId: "clientA-adapter",
        }),
      ],
    })

    // Client B connects only to serverBridgeToB
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

  describe("Ephemeral relay through hub", () => {
    it("should propagate presence from clientA to clientB through server", async () => {
      const docId = "hub-spoke-doc"

      // All three repos get the same document
      const handleA = clientA.get(docId)
      const handleB = clientB.get(docId)
      const _handleServer = server.get(docId)

      // Wait for all connections to establish and sync
      await new Promise(resolve => setTimeout(resolve, 200))

      // Subscribe to presence changes on clientB
      const onChangeB = vi.fn()
      handleB.presence.subscribe(onChangeB)

      // Clear the initial call from subscribe
      onChangeB.mockClear()

      // ClientA sets presence
      handleA.presence.set({ status: "online", cursor: { x: 100, y: 200 } })

      // Wait for propagation through server to clientB
      // This should be nearly instant, not require waiting for heartbeat
      await new Promise(resolve => setTimeout(resolve, 100))

      // ClientB should have received clientA's presence
      const peerIdA = clientA.identity.peerId
      const clientAPresenceOnB = handleB.presence.all[peerIdA]

      expect(clientAPresenceOnB).toEqual({
        status: "online",
        cursor: { x: 100, y: 200 },
      })

      // The onChange callback should have been called
      expect(onChangeB).toHaveBeenCalled()
    })

    it("should propagate presence updates bidirectionally through hub", async () => {
      const docId = "bidirectional-doc"

      const handleA = clientA.get(docId)
      const handleB = clientB.get(docId)
      server.get(docId)

      // Wait for connections
      await new Promise(resolve => setTimeout(resolve, 200))

      // Both clients set presence
      handleA.presence.set({ user: "Alice" })
      handleB.presence.set({ user: "Bob" })

      // Wait for propagation
      await new Promise(resolve => setTimeout(resolve, 100))

      const peerIdA = clientA.identity.peerId
      const peerIdB = clientB.identity.peerId

      // ClientA should see ClientB's presence
      expect(handleA.presence.all[peerIdB]).toEqual({ user: "Bob" })

      // ClientB should see ClientA's presence
      expect(handleB.presence.all[peerIdA]).toEqual({ user: "Alice" })
    })
  })

  describe("Late joiner receives existing presence", () => {
    it("should send existing presence to newly connected peer", async () => {
      const docId = "late-joiner-doc"

      // ClientA connects and sets presence BEFORE clientB connects
      const handleA = clientA.get(docId)
      server.get(docId)

      // Wait for A to connect to server
      await new Promise(resolve => setTimeout(resolve, 100))

      // ClientA sets presence while B is not yet connected
      handleA.presence.set({ status: "active", name: "Alice" })

      // Wait a bit for the presence to be stored on server
      await new Promise(resolve => setTimeout(resolve, 50))

      // Now clientB connects and gets the document
      const handleB = clientB.get(docId)

      // Wait for B to connect and sync
      await new Promise(resolve => setTimeout(resolve, 200))

      // ClientB should have received ClientA's presence via the sync-request handler
      const peerIdA = clientA.identity.peerId
      const clientAPresenceOnB = handleB.presence.all[peerIdA]

      expect(clientAPresenceOnB).toEqual({ status: "active", name: "Alice" })
    })
  })

  describe("Presence count updates immediately", () => {
    it("should show correct user count immediately after connection", async () => {
      const docId = "user-count-doc"

      // Helper to count users with presence
      const countUsers = (handle: ReturnType<typeof clientA.get>) => {
        return Object.keys(handle.presence.all).filter(
          key => handle.presence.all[key] != null,
        ).length
      }

      // ClientA connects and sets presence
      const handleA = clientA.get(docId)
      server.get(docId)
      await new Promise(resolve => setTimeout(resolve, 100))

      handleA.presence.set({ type: "user" })
      await new Promise(resolve => setTimeout(resolve, 50))

      // ClientB connects
      const handleB = clientB.get(docId)
      handleB.presence.set({ type: "user" })

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 200))

      // Both clients should see 2 users (themselves + the other)
      // Note: The server's presence is not set, so it shouldn't count
      expect(countUsers(handleA)).toBeGreaterThanOrEqual(2)
      expect(countUsers(handleB)).toBeGreaterThanOrEqual(2)
    })
  })

  describe("Regression: Direct peer-to-peer still works", () => {
    it("should sync presence directly between two peers (no hub)", async () => {
      // This test uses direct peer-to-peer (like existing tests)
      // to ensure we don't break that case
      const directBridge = new Bridge()

      const peer1 = new Repo({
        identity: { name: "peer1", type: "user" },
        adapters: [
          new BridgeAdapter({ bridge: directBridge, adapterId: "peer1" }),
        ],
      })

      const peer2 = new Repo({
        identity: { name: "peer2", type: "user" },
        adapters: [
          new BridgeAdapter({ bridge: directBridge, adapterId: "peer2" }),
        ],
      })

      const docId = "direct-peer-doc"
      const handle1 = peer1.get(docId)
      const handle2 = peer2.get(docId)

      await new Promise(resolve => setTimeout(resolve, 100))

      handle1.presence.set({ direct: true })

      await new Promise(resolve => setTimeout(resolve, 100))

      const peerId1 = peer1.identity.peerId
      expect(handle2.presence.all[peerId1]).toEqual({ direct: true })

      // Cleanup
      peer1.synchronizer.stopHeartbeat()
      peer2.synchronizer.stopHeartbeat()
    })
  })
})
