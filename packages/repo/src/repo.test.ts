import { type Infer, Shape } from "@loro-extended/change"
import { beforeEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "./adapter/bridge-adapter.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import { TypedDocHandle } from "./typed-doc-handle.js"
import { UntypedDocHandle } from "./untyped-doc-handle.js"
import { UntypedWithPresenceHandle } from "./untyped-with-presence-handle.js"

// Test schema for typed document tests
const TestDocSchema = Shape.doc({
  root: Shape.map({
    text: Shape.text().placeholder(""),
  }),
})

// Test schema for Shape.any() with typed presence (loro-prosemirror pattern)
const AnyDocSchema = Shape.doc({
  doc: Shape.any(), // External library manages this
})

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

  describe("getUntyped", () => {
    it("should create a new document and return an untyped handle", () => {
      const handle = repo.getUntyped("test-doc")
      expect(handle).toBeInstanceOf(UntypedDocHandle)
      expect(handle.doc).toBeDefined()
    })

    it("should create a document with a specific ID", () => {
      const documentId = "custom-doc-id"
      const handle = repo.getUntyped(documentId)
      expect(handle.docId).toBe(documentId)
      expect(handle.doc).toBeDefined()
    })

    it("should create a document with initial value", () => {
      const handle = repo.getUntyped("test-doc").batch(doc => {
        const root = doc.getMap("root")
        root.set("text", "initial")
      })

      // The document should have the initial value
      const root = handle.doc.getMap("root")
      expect(root.get("text")).toBe("initial")
    })

    it("should find an existing document handle", () => {
      const handle = repo.getUntyped("test-doc")
      const foundHandle = repo.getUntyped(handle.docId)
      expect(foundHandle).toBe(handle)
    })

    it("should return a new handle for non-existent documents", () => {
      const handle = repo.getUntyped("non-existent-doc")
      expect(handle).toBeInstanceOf(UntypedDocHandle)
      expect(handle.docId).toBe("non-existent-doc")
      expect(handle.doc).toBeDefined()
    })
  })

  describe("get (typed)", () => {
    it("should create a typed document handle", () => {
      const handle = repo.get("test-doc", TestDocSchema)
      expect(handle).toBeInstanceOf(TypedDocHandle)
      expect(handle.doc).toBeDefined()
      expect(handle.docId).toBe("test-doc")
    })

    it("should provide typed access to document", () => {
      const handle = repo.get("test-doc", TestDocSchema)

      // Change using typed API
      handle.change(draft => {
        draft.root.text.insert(0, "hello")
      })

      // Read using typed API
      expect(handle.doc.root.text.toString()).toBe("hello")
    })

    it("should share underlying untyped handle", () => {
      const typedHandle = repo.get("test-doc", TestDocSchema)
      const untypedHandle = repo.getUntyped("test-doc")

      // They should share the same underlying document
      expect(typedHandle.untyped).toBe(untypedHandle)
    })
  })

  describe("get with Shape.any() and typed presence", () => {
    it("should create a typed handle with Shape.any() document and typed presence", () => {
      const handle = repo.get("test-doc", AnyDocSchema, CursorPresenceSchema)
      expect(handle).toBeInstanceOf(TypedDocHandle)
      expect(handle.doc).toBeDefined()
      expect(handle.presence).toBeDefined()
    })

    it("should allow typed presence operations with Shape.any() document", () => {
      const handle = repo.get("test-doc", AnyDocSchema, CursorPresenceSchema)

      // Set presence with Uint8Array (no base64 encoding needed!)
      const anchorData = new Uint8Array([1, 2, 3, 4, 5])
      handle.presence.set({
        anchor: anchorData,
        focus: null,
        user: { name: "Alice", color: "#ff0000" },
      })

      // Read presence - should be typed
      expect(handle.presence.self.anchor).toEqual(anchorData)
      expect(handle.presence.self.focus).toBeNull()
      expect(handle.presence.self.user).toEqual({
        name: "Alice",
        color: "#ff0000",
      })
    })

    it("should provide access to untyped document via handle.untyped", () => {
      const handle = repo.get("test-doc", AnyDocSchema, CursorPresenceSchema)

      // Access the raw LoroDoc through untyped handle
      const loroDoc = handle.untyped.doc

      // Can use raw Loro API
      const map = loroDoc.getMap("doc")
      map.set("key", "value")

      expect(map.get("key")).toBe("value")
    })

    it("should infer document type as unknown for Shape.any()", () => {
      const handle = repo.get("test-doc", AnyDocSchema, CursorPresenceSchema)

      // First, set some data in the untyped container
      handle.untyped.doc.getMap("doc").set("key", "value")

      // Type test: doc.doc should be typed as unknown
      // This is a compile-time check - if it compiles, the test passes
      const docContent: unknown = handle.doc.toJSON().doc
      expect(docContent).toBeDefined() // Runtime check that it exists
    })

    it("should infer presence type correctly", () => {
      const handle = repo.get("test-doc", AnyDocSchema, CursorPresenceSchema)

      // Type test: presence should be fully typed
      type ExpectedPresenceType = Infer<typeof CursorPresenceSchema>
      const presence: ExpectedPresenceType = handle.presence.self

      // Runtime checks
      expect(presence).toHaveProperty("anchor")
      expect(presence).toHaveProperty("focus")
      expect(presence).toHaveProperty("user")
    })
  })

  describe("get with Shape.any() directly (document-level escape hatch)", () => {
    it("should create an UntypedWithPresenceHandle when Shape.any() is passed directly", () => {
      const handle = repo.get("test-doc", Shape.any(), CursorPresenceSchema)
      expect(handle).toBeInstanceOf(UntypedWithPresenceHandle)
      expect(handle.doc).toBeDefined()
      expect(handle.presence).toBeDefined()
    })

    it("should provide raw LoroDoc access", () => {
      const handle = repo.get("test-doc", Shape.any(), CursorPresenceSchema)

      // doc is the raw LoroDoc
      const loroDoc = handle.doc
      expect(loroDoc.getMap).toBeDefined() // LoroDoc method

      // Can use raw Loro API directly
      const map = loroDoc.getMap("anything")
      map.set("key", "value")
      expect(map.get("key")).toBe("value")
    })

    it("should provide typed presence", () => {
      const handle = repo.get("test-doc", Shape.any(), CursorPresenceSchema)

      // Set presence with Uint8Array
      const anchorData = new Uint8Array([1, 2, 3, 4, 5])
      handle.presence.set({
        anchor: anchorData,
        focus: null,
        user: { name: "Bob", color: "#00ff00" },
      })

      // Read presence - should be typed
      expect(handle.presence.self.anchor).toEqual(anchorData)
      expect(handle.presence.self.focus).toBeNull()
      expect(handle.presence.self.user).toEqual({
        name: "Bob",
        color: "#00ff00",
      })
    })

    it("should share underlying untyped handle", () => {
      const handle = repo.get("test-doc", Shape.any(), CursorPresenceSchema)
      const untypedHandle = repo.getUntyped("test-doc")

      // They should share the same underlying document
      expect(handle.untyped).toBe(untypedHandle)
    })

    it("should infer presence type correctly", () => {
      const handle = repo.get("test-doc", Shape.any(), CursorPresenceSchema)

      // Type test: presence should be fully typed
      type ExpectedPresenceType = Infer<typeof CursorPresenceSchema>
      const presence: ExpectedPresenceType = handle.presence.self

      // Runtime checks
      expect(presence).toHaveProperty("anchor")
      expect(presence).toHaveProperty("focus")
      expect(presence).toHaveProperty("user")
    })
  })

  describe("network sync", () => {
    it("should find a document from a peer", async () => {
      // Use real timers for this test since it involves network communication

      const bridge = new Bridge()

      const networkA = new BridgeAdapter({ adapterType: "network-a", bridge })
      const repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [networkA],
      })

      const networkB = new BridgeAdapter({ adapterType: "network-b", bridge })
      const repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [networkB],
      })

      // Give some time for the network adapters to connect
      await new Promise(resolve => setTimeout(resolve, 100))

      const handleA = repoA.getUntyped("test-doc")

      handleA.batch(doc => {
        const root = doc.getMap("root")
        root.set("text", "hello")
      })

      const handleB = repoB.getUntyped(handleA.docId)

      const result = await handleB.waitForNetwork()

      const rootB = result.doc.getMap("root")
      expect(rootB.get("text")).toBe("hello")
    }, 1000)
  })

  describe("document deletion", () => {
    it("should handle document deletion", async () => {
      const handle = repo.getUntyped("test-doc")
      const documentId = handle.docId

      // Document should exist in cache
      expect(repo.has(documentId)).toBe(true)

      // Wait for storage adapter to finish its sync-request cycle
      // This ensures the reciprocal sync-request from storage is processed
      // before we delete the document
      // TODO(duane): can we use synthetic time here, to prevent potential flaky test in future?
      await new Promise(resolve => setTimeout(resolve, 50))

      await repo.delete(documentId)

      // Document should be removed from cache
      expect(repo.has(documentId)).toBe(false)
    })
  })
})
