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
})
