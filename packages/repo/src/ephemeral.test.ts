import { Shape } from "@loro-extended/change"
import { describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "./adapter/bridge-adapter.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import { sync } from "./sync.js"

// Simple presence schema for testing
const PresenceSchema = Shape.plain.struct({
  status: Shape.plain.string(),
})

// Document schema
const DocSchema = Shape.doc({
  content: Shape.text(),
})

describe("Ephemeral Store Integration", () => {
  it("should allow setting and getting local ephemeral state", () => {
    const repo = new Repo({
      identity: { name: "repo1", type: "user" },
      adapters: [new InMemoryStorageAdapter()],
    })
    const doc = repo.get("test-doc", DocSchema, {
      presence: PresenceSchema,
    })

    // Set local state using the new API
    sync(doc).presence.setSelf({ status: "online" })

    // Get local state
    expect(sync(doc).presence.self).toEqual({ status: "online" })
  })

  it("should sync ephemeral state between peers", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user", peerId: "1" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user", peerId: "2" },
    })

    const docId = "ephemeral-sync-doc"
    const doc1 = repo1.get(docId, DocSchema, {
      presence: PresenceSchema,
    })
    const doc2 = repo2.get(docId, DocSchema, {
      presence: PresenceSchema,
    })

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 100))

    // Subscribe to changes on repo2
    const onChange = vi.fn()
    sync(doc2).presence.subscribe(onChange)

    // Set state on repo1
    sync(doc1).presence.setSelf({ status: "online" })

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify repo2 received the update
    expect(onChange).toHaveBeenCalled()

    // Check repo2's view of repo1's state
    const peerState = sync(doc2).presence.get("1")
    expect(peerState).toEqual({ status: "online" })

    // Cleanup
    repo1.synchronizer.stopHeartbeat()
    repo2.synchronizer.stopHeartbeat()
  })

  it("should support raw store access via sync().loroDoc", async () => {
    const repo = new Repo({
      identity: { name: "repo1", type: "user" },
      adapters: [new InMemoryStorageAdapter()],
    })
    const doc = repo.get("test-doc", DocSchema, {
      presence: PresenceSchema,
    })

    // Access presence via sync()
    const presence = sync(doc).presence
    expect(presence).toBeDefined()

    // Can set arbitrary keys on the store
    presence.set("custom-key", { status: "custom" })
    expect(presence.get("custom-key")).toEqual({ status: "custom" })
  })

  it("should sync ephemeral state on initial sync", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user", peerId: "1" },
    })

    // Wait for repo1 to be ready
    await new Promise(resolve => setTimeout(resolve, 100))

    const docId = "initial-sync-doc"
    const doc1 = repo1.get(docId, DocSchema, {
      presence: PresenceSchema,
    })
    sync(doc1).presence.setSelf({ status: "online" })

    // Wait for presence to be set
    await new Promise(resolve => setTimeout(resolve, 50))

    // Create repo2 AFTER repo1 has set state
    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user", peerId: "2" },
    })

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 100))

    const doc2 = repo2.get(docId, DocSchema, {
      presence: PresenceSchema,
    })

    // Wait for sync - heartbeat will propagate the presence
    await new Promise(resolve => setTimeout(resolve, 300))

    const peerState = sync(doc2).presence.get("1")
    expect(peerState).toEqual({ status: "online" })

    // Cleanup
    repo1.synchronizer.stopHeartbeat()
    repo2.synchronizer.stopHeartbeat()
  })

  it("should use TypedEphemeral API correctly", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user", peerId: "1" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user", peerId: "2" },
    })

    const docId = "typed-ephemeral-doc"
    const doc1 = repo1.get(docId, DocSchema, {
      presence: PresenceSchema,
    })
    const doc2 = repo2.get(docId, DocSchema, {
      presence: PresenceSchema,
    })

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 100))

    // Set state on both repos
    sync(doc1).presence.setSelf({ status: "online" })
    sync(doc2).presence.setSelf({ status: "away" })

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 100))

    // Test self accessor
    expect(sync(doc1).presence.self).toEqual({ status: "online" })
    expect(sync(doc2).presence.self).toEqual({ status: "away" })

    // Test peers accessor (excludes self)
    const peers1 = sync(doc1).presence.peers
    expect(peers1.get("2")).toEqual({ status: "away" })
    expect(peers1.has("1")).toBe(false) // Self not in peers

    const peers2 = sync(doc2).presence.peers
    expect(peers2.get("1")).toEqual({ status: "online" })
    expect(peers2.has("2")).toBe(false) // Self not in peers

    // Test getAll (includes self)
    const all1 = sync(doc1).presence.getAll()
    expect(all1.get("1")).toEqual({ status: "online" })
    expect(all1.get("2")).toEqual({ status: "away" })

    // Cleanup
    repo1.synchronizer.stopHeartbeat()
    repo2.synchronizer.stopHeartbeat()
  })
})
