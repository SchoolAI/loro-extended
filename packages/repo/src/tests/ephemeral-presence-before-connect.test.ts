/**
 * Tests for presence propagation during connection establishment.
 *
 * These tests verify that presence data is correctly propagated even when
 * set immediately after repo creation, before channels are fully established.
 *
 * Expected behavior:
 * 1. Client creates Repo with adapter (adapter starts connecting)
 * 2. Client creates document and sets presence immediately
 * 3. Channel establishment completes shortly after
 * 4. Presence is included in the sync-request message
 * 5. Server receives presence atomically with document sync
 * 6. Server relays presence to other connected peers
 *
 * This is achieved by embedding ephemeral data in sync-request/sync-response
 * messages, ensuring atomic delivery of both document and presence state.
 */

import { Shape } from "@loro-extended/change"
import { afterEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"
import { sync } from "../sync.js"

// Schema for test documents
const DocSchema = Shape.doc({
  title: Shape.text(),
})

// Schema for presence
const PresenceSchema = Shape.plain.struct({
  name: Shape.plain.string(),
  status: Shape.plain.string(),
})

const SimplePresenceSchema = Shape.plain.struct({
  name: Shape.plain.string(),
})

const UserPresenceSchema = Shape.plain.struct({
  type: Shape.plain.string(),
  lastSeen: Shape.plain.number(),
})

describe("Ephemeral Store - Presence Set Before Connection", () => {
  const repos: Repo[] = []

  afterEach(() => {
    for (const repo of repos) {
      repo.synchronizer.stopHeartbeat()
    }
    repos.length = 0
  })

  it("should propagate presence set immediately after repo creation", async () => {
    // This test simulates the exact scenario from the logs:
    // 1. Repo is created with adapter
    // 2. Presence is set immediately (before channel establishment)
    // 3. Channel establishment happens async

    const bridgeToA = new Bridge()
    const bridgeToB = new Bridge()

    // Server is already running
    const server = new Repo({
      identity: { name: "server", type: "service" },
      adapters: [
        new BridgeAdapter({ bridge: bridgeToA, adapterType: "server-to-a" }),
        new BridgeAdapter({ bridge: bridgeToB, adapterType: "server-to-b" }),
      ],
    })
    repos.push(server)

    // ClientA connects and sets presence (already established)
    const clientA = new Repo({
      identity: { name: "clientA", type: "user" },
      adapters: [
        new BridgeAdapter({
          bridge: bridgeToA,
          adapterType: "clientA-adapter",
        }),
      ],
    })
    repos.push(clientA)

    const docId = "test-doc"
    const docA = clientA.get(docId, DocSchema, {
      presence: PresenceSchema,
    })
    server.get(docId, DocSchema, { presence: PresenceSchema })

    await new Promise(r => setTimeout(r, 100))
    sync(docA).presence.setSelf({ name: "Alice", status: "online" })
    await new Promise(r => setTimeout(r, 50))

    // Now simulate the problematic scenario:
    // ClientB is created with adapter, but sets presence IMMEDIATELY
    // before the channel has time to establish

    // Create clientB - the adapter will start connecting but channel won't be established yet
    const clientB = new Repo({
      identity: { name: "clientB", type: "user" },
      adapters: [
        new BridgeAdapter({
          bridge: bridgeToB,
          adapterType: "clientB-adapter",
        }),
      ],
    })
    repos.push(clientB)

    // IMMEDIATELY get document and set presence
    // This happens before the channel is established (simulating React useEffect)
    const docB = clientB.get(docId, DocSchema, {
      presence: PresenceSchema,
    })
    sync(docB).presence.setSelf({ name: "Bob", status: "online" })

    // Now wait for everything to sync (increased timeout for reliability)
    await new Promise(r => setTimeout(r, 300))

    // Verify server has clientB's presence
    const serverDoc = server.get(docId, DocSchema, {
      presence: PresenceSchema,
    })
    const serverPresence = sync(serverDoc).presence.getAll()
    const peerIdB = clientB.identity.peerId

    // Server should have clientB's presence (this was the bug)
    expect(serverPresence.has(peerIdB)).toBe(true)
    expect(serverPresence.get(peerIdB)).toMatchObject({
      name: "Bob",
      status: "online",
    })

    // Verify clientA also receives clientB's presence (via server relay)
    const clientAPresence = sync(docA).presence.getAll()
    expect(clientAPresence.has(peerIdB)).toBe(true)
    expect(clientAPresence.get(peerIdB)).toMatchObject({
      name: "Bob",
      status: "online",
    })
  })

  it("should propagate presence from late joiner to existing clients", async () => {
    const bridgeToA = new Bridge()
    const bridgeToB = new Bridge()

    const server = new Repo({
      identity: { name: "server", type: "service" },
      adapters: [
        new BridgeAdapter({ bridge: bridgeToA, adapterType: "server-to-a" }),
        new BridgeAdapter({ bridge: bridgeToB, adapterType: "server-to-b" }),
      ],
    })
    repos.push(server)

    // ClientA connects first
    const clientA = new Repo({
      identity: { name: "clientA", type: "user" },
      adapters: [
        new BridgeAdapter({
          bridge: bridgeToA,
          adapterType: "clientA-adapter",
        }),
      ],
    })
    repos.push(clientA)

    const docId = "test-doc-2"
    const docA = clientA.get(docId, DocSchema, {
      presence: SimplePresenceSchema,
    })
    server.get(docId, DocSchema, { presence: SimplePresenceSchema })

    await new Promise(r => setTimeout(r, 100))
    sync(docA).presence.setSelf({ name: "Alice" })
    await new Promise(r => setTimeout(r, 50))

    // ClientB joins and immediately sets presence
    const clientB = new Repo({
      identity: { name: "clientB", type: "user" },
      adapters: [
        new BridgeAdapter({
          bridge: bridgeToB,
          adapterType: "clientB-adapter",
        }),
      ],
    })
    repos.push(clientB)

    const docB = clientB.get(docId, DocSchema, {
      presence: SimplePresenceSchema,
    })
    sync(docB).presence.setSelf({ name: "Bob" })

    // Wait longer for sync - the late joiner needs time to receive existing presence
    await new Promise(r => setTimeout(r, 500))

    const peerIdA = clientA.identity.peerId
    const peerIdB = clientB.identity.peerId

    // ClientA should see both Alice and Bob
    const clientAPresence = sync(docA).presence.getAll()
    expect(clientAPresence.size).toBeGreaterThanOrEqual(2)
    expect(clientAPresence.has(peerIdA)).toBe(true)
    expect(clientAPresence.has(peerIdB)).toBe(true)

    // ClientB should see both Alice and Bob
    const clientBPresence = sync(docB).presence.getAll()
    expect(clientBPresence.size).toBeGreaterThanOrEqual(2)
    expect(clientBPresence.has(peerIdA)).toBe(true)
    expect(clientBPresence.has(peerIdB)).toBe(true)
  })

  it("should handle presence set in same tick as repo creation", async () => {
    // This simulates the React pattern where everything happens synchronously:
    // const repo = new Repo({ adapters: [...] })
    // const doc = repo.get(docId)
    // sync(doc).presence.setSelf({ ... }) // All in same tick!

    const bridge = new Bridge()

    const server = new Repo({
      identity: { name: "server", type: "service" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "server-adapter" })],
    })
    repos.push(server)

    // All in one synchronous block - no awaits
    const client = new Repo({
      identity: { name: "client", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "client-adapter" })],
    })
    repos.push(client)

    const docId = "test-doc-3"
    const doc = client.get(docId, DocSchema, {
      presence: UserPresenceSchema,
    })
    sync(doc).presence.setSelf({ type: "user", lastSeen: Date.now() })

    // Now wait for async operations to complete (increased timeout for reliability)
    await new Promise(r => setTimeout(r, 300))

    // Server should have client's presence
    const serverDoc = server.get(docId, DocSchema, {
      presence: UserPresenceSchema,
    })
    const serverPresence = sync(serverDoc).presence.getAll()
    const clientPeerId = client.identity.peerId

    expect(serverPresence.has(clientPeerId)).toBe(true)
    expect(serverPresence.get(clientPeerId)?.type).toBe("user")
  })
})
