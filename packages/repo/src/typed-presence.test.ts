import { Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { DocHandle } from "./doc-handle.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import { Synchronizer } from "./synchronizer.js"

describe("TypedPresence", () => {
  it("should provide typed access to presence", () => {
    const storage = new InMemoryStorageAdapter()
    const synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-peer", type: "user" },
      adapters: [storage],
    })
    const handle = new DocHandle({ docId: "test-doc", synchronizer })

    const PresenceSchema = Shape.plain.object({
      name: Shape.plain.string(),
      cursor: Shape.plain.object({
        x: Shape.plain.number(),
        y: Shape.plain.number(),
      }),
    })

    const EmptyPresence = {
      name: "Anonymous",
      cursor: { x: 0, y: 0 },
    }

    const presence = handle.presence(PresenceSchema, EmptyPresence)

    // Check default values
    expect(presence.self).toEqual(EmptyPresence)

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

    expect(presence.all[peerId]).toEqual({
      name: "Bob",
      cursor: { x: 0, y: 0 }, // Default applied
    })
  })
})
