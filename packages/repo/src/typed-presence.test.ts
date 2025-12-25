import { Shape, TypedPresence } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import { Synchronizer } from "./synchronizer.js"
import { UntypedDocHandle } from "./untyped-doc-handle.js"

describe("TypedPresence", () => {
  it("should provide typed access to presence", () => {
    const storage = new InMemoryStorageAdapter()
    const synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-peer", type: "user" },
      adapters: [storage],
    })
    const handle = new UntypedDocHandle({ docId: "test-doc", synchronizer })

    // Schema with placeholder annotations
    const PresenceSchema = Shape.plain.object({
      name: Shape.plain.string().placeholder("Anonymous"),
      cursor: Shape.plain.object({
        x: Shape.plain.number(),
        y: Shape.plain.number(),
      }),
    })

    // Expected placeholder values derived from schema
    const expectedPlaceholder = {
      name: "Anonymous",
      cursor: { x: 0, y: 0 },
    }

    // Create TypedPresence using the handle's presence interface
    const presence = new TypedPresence(PresenceSchema, handle.presence)

    // Check default values are derived from schema placeholders
    expect(presence.self).toEqual(expectedPlaceholder)

    // Update values
    presence.set({ name: "Alice" })
    expect(presence.self.name).toBe("Alice")
    expect(presence.self.cursor).toEqual({ x: 0, y: 0 }) // Should preserve defaults

    // Update nested values
    presence.set({ cursor: { x: 10, y: 20 } })
    expect(presence.self.cursor).toEqual({ x: 10, y: 20 })
    expect(presence.self.name).toBe("Alice")

    // Simulate peer presence by setting values in a peer's store directly
    const peerId = "123456789"
    const peerStore = synchronizer.getOrCreatePeerEphemeralStore(
      "test-doc",
      peerId,
    )
    peerStore.set("name", "Bob")

    // Test the deprecated 'all' property (includes self)
    expect(presence.all[peerId]).toEqual({
      name: "Bob",
      cursor: { x: 0, y: 0 }, // Default applied
    })

    // Test the new 'peers' property (Map, excludes self)
    expect(presence.peers).toBeInstanceOf(Map)
    expect(presence.peers.get(peerId)).toEqual({
      name: "Bob",
      cursor: { x: 0, y: 0 }, // Default applied
    })

    // peers should NOT include self
    const myPeerId = synchronizer.identity.peerId
    expect(presence.peers.has(myPeerId)).toBe(false)

    // all should include self
    expect(presence.all[myPeerId]).toBeDefined()
  })

  it("should handle Uint8Array values in presence (cursor data)", () => {
    const storage = new InMemoryStorageAdapter()
    const synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-peer", type: "user" },
      adapters: [storage],
    })
    const handle = new UntypedDocHandle({ docId: "test-doc", synchronizer })

    // Schema with Uint8Array for cursor data (like loro-prosemirror)
    const CursorPresenceSchema = Shape.plain.struct({
      anchor: Shape.plain.bytes().nullable(),
      focus: Shape.plain.bytes().nullable(),
      user: Shape.plain
        .struct({
          name: Shape.plain.string(),
          color: Shape.plain.string(),
        })
        .nullable(),
    })

    const presence = new TypedPresence(CursorPresenceSchema, handle.presence)

    // Default values should be null (from nullable)
    expect(presence.self.anchor).toBeNull()
    expect(presence.self.focus).toBeNull()
    expect(presence.self.user).toBeNull()

    // Set Uint8Array values directly (no base64 encoding needed!)
    const anchorData = new Uint8Array([1, 2, 3, 4, 5])
    const focusData = new Uint8Array([6, 7, 8, 9, 10])

    presence.set({
      anchor: anchorData,
      focus: focusData,
      user: { name: "Alice", color: "#ff0000" },
    })

    // Verify Uint8Array values are preserved
    expect(presence.self.anchor).toEqual(anchorData)
    expect(presence.self.focus).toEqual(focusData)
    expect(presence.self.user).toEqual({ name: "Alice", color: "#ff0000" })

    // Simulate peer presence with Uint8Array
    const peerId = "123456789" as `${number}`
    const peerStore = synchronizer.getOrCreatePeerEphemeralStore(
      "test-doc",
      peerId,
    )
    const peerAnchor = new Uint8Array([11, 12, 13])
    peerStore.set("anchor", peerAnchor)
    peerStore.set("user", { name: "Bob", color: "#00ff00" })

    // Verify peer's Uint8Array is accessible
    const peerPresence = presence.peers.get(peerId)
    expect(peerPresence?.anchor).toEqual(peerAnchor)
    expect(peerPresence?.focus).toBeNull() // Default from nullable
    expect(peerPresence?.user).toEqual({ name: "Bob", color: "#00ff00" })
  })

  it("should handle Shape.any() in presence", () => {
    const storage = new InMemoryStorageAdapter()
    const synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-peer", type: "user" },
      adapters: [storage],
    })
    const handle = new UntypedDocHandle({ docId: "test-doc", synchronizer })

    // Schema with any value for flexible metadata
    const FlexiblePresenceSchema = Shape.plain.struct({
      name: Shape.plain.string(),
      metadata: Shape.plain.any(),
    })

    const presence = new TypedPresence(FlexiblePresenceSchema, handle.presence)

    // Set various types of metadata
    presence.set({
      name: "Alice",
      metadata: { custom: "data", nested: { value: 123 } },
    })

    expect(presence.self.name).toBe("Alice")
    expect(presence.self.metadata).toEqual({
      custom: "data",
      nested: { value: 123 },
    })

    // Update with different metadata type
    presence.set({
      metadata: [1, 2, 3],
    })

    expect(presence.self.metadata).toEqual([1, 2, 3])
  })
})
