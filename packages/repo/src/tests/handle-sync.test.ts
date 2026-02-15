import { Shape } from "@loro-extended/change"
import { afterEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"
import { sync } from "../sync.js"

/**
 * Integration tests for ephemeral store sync via sync() API.
 * These tests verify that the repo.get() + sync() API correctly syncs
 * ephemeral stores between peers.
 */

const DocSchema = Shape.doc({
  title: Shape.text(),
})

// Ephemeral store shapes use Shape.plain.struct for value types
const PresenceSchema = Shape.plain.struct({
  status: Shape.plain.string(),
})

const MouseSchema = Shape.plain.struct({
  x: Shape.plain.number(),
  y: Shape.plain.number(),
})

describe("Ephemeral Sync via sync()", () => {
  let repo1: Repo
  let repo2: Repo

  afterEach(() => {
    repo1?.synchronizer.stopHeartbeat()
    repo2?.synchronizer.stopHeartbeat()
  })

  describe("Single ephemeral store", () => {
    it("should sync presence between two peers", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Create docs with presence
      const doc1 = repo1.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      const doc2 = repo2.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Set presence on peer1
      sync(doc1).getTypedEphemeral("presence").setSelf({ status: "online" })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify peer2 sees peer1's presence
      const peer1Presence = sync(doc2).getTypedEphemeral("presence").get("1")
      expect(peer1Presence).toEqual({ status: "online" })
    })

    it("should sync bidirectional presence updates", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const doc1 = repo1.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      const doc2 = repo2.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Both peers set their presence
      sync(doc1).getTypedEphemeral("presence").setSelf({ status: "online" })
      sync(doc2).getTypedEphemeral("presence").setSelf({ status: "away" })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify both see each other
      const presence1 = sync(doc1).getTypedEphemeral("presence")
      const presence2 = sync(doc2).getTypedEphemeral("presence")

      expect(presence1.get("2")).toEqual({ status: "away" })
      expect(presence2.get("1")).toEqual({ status: "online" })
    })
  })

  describe("Multiple ephemeral stores", () => {
    it("should sync multiple stores independently", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Create docs with multiple ephemeral stores
      const doc1 = repo1.get("doc-1", DocSchema, {
        presence: PresenceSchema,
        mouse: MouseSchema,
      })

      const doc2 = repo2.get("doc-1", DocSchema, {
        presence: PresenceSchema,
        mouse: MouseSchema,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Set different data in different stores
      sync(doc1).getTypedEphemeral("presence").setSelf({ status: "online" })
      sync(doc1).getTypedEphemeral("mouse").setSelf({ x: 100, y: 200 })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify both stores synced
      const presence2 = sync(doc2).getTypedEphemeral("presence")
      const mouse2 = sync(doc2).getTypedEphemeral("mouse")

      expect(presence2.get("1")).toEqual({ status: "online" })
      expect(mouse2.get("1")).toEqual({ x: 100, y: 200 })
    })

    it("should allow updates to one store without affecting another", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const doc1 = repo1.get("doc-1", DocSchema, {
        presence: PresenceSchema,
        mouse: MouseSchema,
      })

      const doc2 = repo2.get("doc-1", DocSchema, {
        presence: PresenceSchema,
        mouse: MouseSchema,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Set presence once
      sync(doc1).getTypedEphemeral("presence").setSelf({ status: "online" })

      await new Promise(resolve => setTimeout(resolve, 50))

      // Update mouse position
      sync(doc1).getTypedEphemeral("mouse").setSelf({ x: 100, y: 200 })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify mouse synced
      const mouse2 = sync(doc2).getTypedEphemeral("mouse")
      expect(mouse2.get("1")).toEqual({ x: 100, y: 200 })

      // Presence should still be intact
      const presence2 = sync(doc2).getTypedEphemeral("presence")
      expect(presence2.get("1")).toEqual({ status: "online" })
    })
  })

  describe("External store integration", () => {
    it("should sync external stores registered via addEphemeral", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Create docs without declared ephemeral stores
      const doc1 = repo1.get("doc-1", DocSchema)
      const doc2 = repo2.get("doc-1", DocSchema)

      await new Promise(resolve => setTimeout(resolve, 100))

      // Create and register external stores
      const { EphemeralStore } = await import("loro-crdt")
      const externalStore1 = new EphemeralStore(10000)
      const externalStore2 = new EphemeralStore(10000)

      sync(doc1).addEphemeral("custom", externalStore1)
      sync(doc2).addEphemeral("custom", externalStore2)

      await new Promise(resolve => setTimeout(resolve, 100))

      // Set data on external store
      externalStore1.set("key1", { value: "from-peer1" })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify it synced
      expect(externalStore2.get("key1")).toEqual({ value: "from-peer1" })
    })
  })

  describe("TypedEphemeral API", () => {
    it("should provide self/peers convenience accessors", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const doc1 = repo1.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      const doc2 = repo2.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const presence1 = sync(doc1).getTypedEphemeral("presence")
      const presence2 = sync(doc2).getTypedEphemeral("presence")

      // Set using setSelf
      presence1.setSelf({ status: "online" })
      presence2.setSelf({ status: "away" })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Read using self
      expect(presence1.self).toEqual({ status: "online" })
      expect(presence2.self).toEqual({ status: "away" })

      // Read using peers
      const peers1 = presence1.peers
      const peers2 = presence2.peers

      expect(peers1.get("2")).toEqual({ status: "away" })
      expect(peers2.get("1")).toEqual({ status: "online" })

      // peers should not include self
      expect(peers1.has("1")).toBe(false)
      expect(peers2.has("2")).toBe(false)
    })

    it("should provide getAll() for all key-value pairs", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const doc1 = repo1.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      const doc2 = repo2.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      sync(doc1).getTypedEphemeral("presence").setSelf({ status: "online" })
      sync(doc2).getTypedEphemeral("presence").setSelf({ status: "away" })

      await new Promise(resolve => setTimeout(resolve, 100))

      // getAll should include both self and peers
      const all1 = sync(doc1).getTypedEphemeral("presence").getAll()
      expect(all1.size).toBe(2)
      expect(all1.get("1")).toEqual({ status: "online" })
      expect(all1.get("2")).toEqual({ status: "away" })
    })

    it("should only emit events for changed keys (O(1) not O(n))", async () => {
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const doc1 = repo1.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      const doc2 = repo2.get("doc-1", DocSchema, {
        presence: PresenceSchema,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Set initial presence for both peers
      sync(doc1).getTypedEphemeral("presence").setSelf({ status: "online" })
      sync(doc2).getTypedEphemeral("presence").setSelf({ status: "away" })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Track events on doc1's subscription
      const events: Array<{ key: string; source: string }> = []
      const unsub = sync(doc1)
        .getTypedEphemeral("presence")
        .subscribe(event => {
          // Skip initial events
          if (event.source !== "initial") {
            events.push({ key: event.key, source: event.source })
          }
        })

      // Update only peer2's presence
      sync(doc2).getTypedEphemeral("presence").setSelf({ status: "busy" })

      await new Promise(resolve => setTimeout(resolve, 100))

      unsub()

      // Should only have received ONE event for peer2's key, not events for all keys
      expect(events.length).toBe(1)
      expect(events[0].key).toBe("2")
      expect(events[0].source).toBe("remote")
    })
  })
})
