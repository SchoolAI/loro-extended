import { Shape } from "@loro-extended/change"
import { beforeEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "./adapter/bridge-adapter.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import { TypedDocHandle } from "./typed-doc-handle.js"
import { UntypedDocHandle } from "./untyped-doc-handle.js"

// Test schema for typed document tests
const TestDocSchema = Shape.doc({
  root: Shape.map({
    text: Shape.text().placeholder(""),
  }),
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
      const handle = repo.getUntyped("test-doc").change(doc => {
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
      expect(handle.value.root.text.toString()).toBe("hello")
    })

    it("should share underlying untyped handle", () => {
      const typedHandle = repo.get("test-doc", TestDocSchema)
      const untypedHandle = repo.getUntyped("test-doc")

      // They should share the same underlying document
      expect(typedHandle.untyped).toBe(untypedHandle)
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

      handleA.change(doc => {
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
