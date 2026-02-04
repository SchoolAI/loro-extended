import { change, Shape } from "@loro-extended/change"
import { EphemeralStore } from "loro-crdt"
import { afterEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"

// Test schemas
const DocSchema = Shape.doc({
  title: Shape.text(),
})

const PresenceSchema = Shape.plain.struct({
  status: Shape.plain.string(),
})

/**
 * Tests to investigate the subscription hang issue.
 */
describe("Namespaced Store Sync Investigation", () => {
  it("should handle subscription with queueMicrotask", async () => {
    const store = new EphemeralStore(10000)
    const events: string[] = []

    const unsub = store.subscribe(event => {
      events.push(`event: ${event.by}`)

      if (event.by === "local") {
        queueMicrotask(() => {
          events.push("microtask executed")
        })
      }
    })

    store.set("test", { x: 1 })

    // Wait for microtask
    await new Promise(resolve => setTimeout(resolve, 10))

    unsub()

    expect(events).toContain("event: local")
    expect(events).toContain("microtask executed")
  })

  it("should handle multiple sets without hanging", async () => {
    const store = new EphemeralStore(10000)
    let eventCount = 0

    const unsub = store.subscribe(event => {
      eventCount++
      if (event.by === "local") {
        queueMicrotask(() => {
          // Simulate broadcast
        })
      }
    })

    // Multiple rapid sets
    for (let i = 0; i < 10; i++) {
      store.set(`key-${i}`, { value: i })
    }

    await new Promise(resolve => setTimeout(resolve, 50))

    unsub()

    expect(eventCount).toBe(10)
  })

  it("should not hang when subscription is cleaned up", async () => {
    const store = new EphemeralStore(10000)

    const unsub = store.subscribe(event => {
      if (event.by === "local") {
        queueMicrotask(() => {
          // This should not cause issues
        })
      }
    })

    store.set("test", { x: 1 })

    // Immediately unsubscribe
    unsub()

    // Should complete without hanging
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  describe("Handle with ephemeral stores", () => {
    it("should create handle with ephemeral stores without hanging", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      // This should not hang
      expect(handle.presence).toBeDefined()
    })

    it("should set ephemeral values without hanging", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user", peerId: "123" as `${number}` },
        adapters: [],
      })

      const handle = repo.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      // This should not hang
      handle.presence.setSelf({ status: "online" })

      expect(handle.presence.self).toEqual({ status: "online" })
    })
  })

  describe("BridgeAdapter interaction", () => {
    let repo1: Repo
    let repo2: Repo

    afterEach(() => {
      // Clean up heartbeats to prevent test hangs
      repo1?.synchronizer.stopHeartbeat()
      repo2?.synchronizer.stopHeartbeat()
    })

    it("should work with BridgeAdapter without ephemeral stores", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      // Just get handles without ephemeral stores
      const handle1 = repo1.get("doc-1", DocSchema)
      const _handle2 = repo2.get("doc-1", DocSchema)

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 100))

      // Modify document
      change(handle1.doc, draft => {
        draft.title.insert(0, "Hello")
      })

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 100))

      // This should work
      expect(handle1.doc.toJSON().title).toBe("Hello")
    })

    it("should sync ephemeral stores between peers via explicit broadcast", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      // Get handles with ephemeral stores
      const handle1 = repo1.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      const handle2 = repo2.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 100))

      // Set presence on peer1 - this triggers explicit broadcast
      handle1.presence.setSelf({ status: "online" })

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify local state
      expect(handle1.presence.self).toEqual({ status: "online" })

      // Verify sync to peer2
      // The broadcast should have sent the data to peer2
      const peer1PresenceOnPeer2 = handle2.presence.get("1")
      expect(peer1PresenceOnPeer2).toEqual({ status: "online" })
    })

    it("should sync bidirectionally", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      const handle1 = repo1.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      const handle2 = repo2.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 100))

      // Set presence on both peers
      handle1.presence.setSelf({ status: "online" })
      handle2.presence.setSelf({ status: "away" })

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify peer1 sees peer2's presence
      expect(handle1.presence.get("2")).toEqual({ status: "away" })

      // Verify peer2 sees peer1's presence
      expect(handle2.presence.get("1")).toEqual({ status: "online" })
    })
  })
})
