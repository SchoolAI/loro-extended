import { Shape, loro } from "@loro-extended/change"
import { beforeEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "./adapter/bridge-adapter.js"
import { Handle } from "./handle.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"

// Test schema for typed document tests
const TestDocSchema = Shape.doc({
  root: Shape.map({
    text: Shape.text().placeholder(""),
  }),
})

// Test schema for Shape.any() (loro-prosemirror pattern)
const AnyDocSchema = Shape.doc({
  doc: Shape.any(), // External library manages this
})

// Ephemeral store schemas
const PresenceSchema = Shape.plain.struct({
  status: Shape.plain.string(),
})

const CursorSchema = Shape.plain.struct({
  anchor: Shape.plain.bytes().nullable(),
  focus: Shape.plain.bytes().nullable(),
  user: Shape.plain
    .struct({
      name: Shape.plain.string(),
      color: Shape.plain.string(),
    })
    .nullable(),
})

describe("Repo", () => {
  let repo: Repo
  let storage: InMemoryStorageAdapter

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()

    repo = new Repo({
      adapters: [storage],
      identity: { name: "test-repo", type: "user" },
    })
  })

  describe("get() - Unified Handle API", () => {
    it("should create a Handle with typed document", () => {
      const handle = repo.get("test-doc", TestDocSchema)
      expect(handle).toBeInstanceOf(Handle)
      expect(handle.doc).toBeDefined()
      expect(handle.docId).toBe("test-doc")
    })

    it("should provide typed access to document via doc.$", () => {
      const handle = repo.get("test-doc", TestDocSchema)

      // Change using typed API
      handle.change(draft => {
        draft.root.text.insert(0, "hello")
      })

      // Read using typed API
      expect(handle.doc.toJSON().root.text).toBe("hello")
    })

    it("should support Shape.any() for untyped documents", () => {
      const handle = repo.get("test-doc", AnyDocSchema)
      expect(handle).toBeInstanceOf(Handle)
      expect(handle.doc).toBeDefined()

      // Access raw LoroDoc via escape hatch
      const loroDoc = loro(handle.doc).doc
      const map = loroDoc.getMap("doc")
      map.set("key", "value")
      expect(map.get("key")).toBe("value")
    })

    it("should support ephemeral store declarations", () => {
      const handle = repo.get("test-doc", TestDocSchema, {
        presence: PresenceSchema,
      })

      // Access ephemeral store via getTypedEphemeral
      const presence = handle.getTypedEphemeral("presence")
      expect(presence).toBeDefined()

      // Set and get presence
      presence.setSelf({ status: "online" })
      expect(presence.self).toEqual({ status: "online" })
    })

    it("should support multiple ephemeral stores", () => {
      const handle = repo.get("test-doc", TestDocSchema, {
        presence: PresenceSchema,
        cursors: CursorSchema,
      })

      // Both stores should be accessible
      const presence = handle.getTypedEphemeral("presence")
      const cursors = handle.getTypedEphemeral("cursors")

      presence.setSelf({ status: "online" })
      cursors.setSelf({
        anchor: new Uint8Array([1, 2, 3]),
        focus: null,
        user: { name: "Alice", color: "#ff0000" },
      })

      expect(presence.self).toEqual({ status: "online" })
      expect(cursors.self?.user?.name).toBe("Alice")
    })

    it("should provide access to ephemeral stores as properties via proxy", () => {
      const handle = repo.get("test-doc", TestDocSchema, {
        presence: PresenceSchema,
      })

      // Access via property (proxy) - TypeScript knows about this via HandleWithEphemerals type
      const presence = handle.presence
      expect(presence).toBeDefined()
      expect(presence.setSelf).toBeDefined()
    })
  })

  describe("network sync", () => {
    it("should sync documents between peers", async () => {
      const bridge = new Bridge()

      const repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [new BridgeAdapter({ adapterType: "network-a", bridge })],
      })

      const repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [new BridgeAdapter({ adapterType: "network-b", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const handleA = repoA.get("test-doc", TestDocSchema)
      handleA.change(draft => {
        draft.root.text.insert(0, "hello")
      })

      const handleB = repoB.get("test-doc", TestDocSchema)
      await handleB.waitForSync({ timeout: 0 })

      expect(handleB.doc.toJSON().root.text).toBe("hello")

      // Cleanup
      repoA.synchronizer.stopHeartbeat()
      repoB.synchronizer.stopHeartbeat()
    }, 1000)

    it("should sync ephemeral stores between peers", async () => {
      const bridge = new Bridge()

      const repoA = new Repo({
        identity: { name: "repoA", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-a", bridge })],
      })

      const repoB = new Repo({
        identity: { name: "repoB", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-b", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const handleA = repoA.get("test-doc", TestDocSchema, {
        presence: PresenceSchema,
      })

      const handleB = repoB.get("test-doc", TestDocSchema, {
        presence: PresenceSchema,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Set presence on A
      handleA.getTypedEphemeral("presence").setSelf({ status: "online" })

      await new Promise(resolve => setTimeout(resolve, 100))

      // B should see A's presence
      const presenceB = handleB.getTypedEphemeral("presence")
      expect(presenceB.get("1")).toEqual({ status: "online" })

      // Cleanup
      repoA.synchronizer.stopHeartbeat()
      repoB.synchronizer.stopHeartbeat()
    }, 1000)
  })

  describe("document management", () => {
    it("should check if document exists with has()", () => {
      expect(repo.has("test-doc")).toBe(false)
      repo.get("test-doc", TestDocSchema)
      // Note: has() checks synchronizer state, not Handle cache
      // The document state is created when we call get()
      expect(repo.has("test-doc")).toBe(true)
    })

    it("should delete documents", async () => {
      const handle = repo.get("test-doc", TestDocSchema)
      expect(repo.has(handle.docId)).toBe(true)

      await new Promise(resolve => setTimeout(resolve, 50))
      await repo.delete(handle.docId)

      expect(repo.has(handle.docId)).toBe(false)
    })
  })

  describe("identity defaults", () => {
    it("creates valid identity with no params", () => {
      const repo = new Repo()

      expect(repo.identity.peerId).toMatch(/^\d+$/) // Valid PeerID format
      expect(repo.identity.type).toBe("user")
      expect(repo.identity.name).toBeUndefined()

      repo.synchronizer.stopHeartbeat()
    })

    it("uses provided identity fields", () => {
      const repo = new Repo({
        identity: { name: "test", type: "service" },
      })

      expect(repo.identity.name).toBe("test")
      expect(repo.identity.type).toBe("service")
      expect(repo.identity.peerId).toBeDefined() // Still auto-generated

      repo.synchronizer.stopHeartbeat()
    })

    it("uses provided peerId when specified", () => {
      const repo = new Repo({
        identity: { peerId: "12345" as `${number}` },
      })

      expect(repo.identity.peerId).toBe("12345")

      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("dynamic adapter management", () => {
    it("can add adapter after construction", async () => {
      const repo = new Repo() // No adapters
      const bridge = new Bridge()
      const adapter = new BridgeAdapter({ adapterType: "test", bridge })

      expect(repo.adapters.length).toBe(0)

      await repo.addAdapter(adapter)

      expect(repo.adapters.length).toBe(1)
      expect(repo.hasAdapter(adapter.adapterId)).toBe(true)

      repo.synchronizer.stopHeartbeat()
    })

    it("can remove adapter at runtime", async () => {
      const bridge = new Bridge()
      const adapter = new BridgeAdapter({ adapterType: "test", bridge })
      const repo = new Repo({ adapters: [adapter] })

      expect(repo.adapters.length).toBe(1)

      await repo.removeAdapter(adapter.adapterId)

      expect(repo.adapters.length).toBe(0)
      expect(repo.hasAdapter(adapter.adapterId)).toBe(false)

      repo.synchronizer.stopHeartbeat()
    })

    it("getAdapter returns adapter or undefined", async () => {
      const bridge = new Bridge()
      const adapter = new BridgeAdapter({
        adapterType: "test",
        adapterId: "my-adapter",
        bridge,
      })
      const repo = new Repo({ adapters: [adapter] })

      expect(repo.getAdapter("my-adapter")).toBe(adapter)
      expect(repo.getAdapter("nonexistent")).toBeUndefined()

      repo.synchronizer.stopHeartbeat()
    })
  })
})
