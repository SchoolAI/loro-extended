import { Shape } from "@loro-extended/change"
import { LoroDoc } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import { TypedDocHandle } from "./typed-doc-handle.js"
import type { UntypedDocHandle } from "./untyped-doc-handle.js"

const crdt = Shape
const value = Shape.plain

// Create a minimal mock of UntypedDocHandle for testing
function createMockUntypedHandle(doc: LoroDoc): UntypedDocHandle {
  return {
    docId: "test-doc",
    peerId: "test-peer",
    doc,
    readyStates: [],
    presence: {
      set: vi.fn(),
      get: vi.fn(),
      self: {},
      peers: new Map(),
      all: {},
      setRaw: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    },
    onReadyStateChange: vi.fn(() => () => {}),
    waitUntilReady: vi.fn(async () => ({}) as UntypedDocHandle),
    waitForStorage: vi.fn(async () => ({}) as UntypedDocHandle),
    waitForNetwork: vi.fn(async () => ({}) as UntypedDocHandle),
    batch: vi.fn(),
  } as unknown as UntypedDocHandle
}

describe("TypedDocHandle.subscribe", () => {
  const docShape = Shape.doc({
    books: crdt.list(
      crdt.map({
        title: value.string(),
        price: value.number(),
      }),
    ),
    config: crdt.map({
      theme: value.string(),
    }),
  })

  const presenceShape = value.object({
    cursor: value.object({ x: value.number(), y: value.number() }),
  })

  describe("regular subscription (backward compatibility)", () => {
    it("should subscribe to all document changes", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe(listener)

      // Make a change
      handle.change(draft => {
        draft.config.theme = "dark"
      })

      // Listener should have been called
      expect(listener).toHaveBeenCalled()
      expect(listener.mock.calls[0][0]).toHaveProperty("by", "local")
      expect(listener.mock.calls[0][0]).toHaveProperty("events")

      // Unsubscribe and make another change
      unsubscribe()
      listener.mockClear()

      handle.change(draft => {
        draft.config.theme = "light"
      })

      // Listener should not be called after unsubscribe
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("JSONPath subscription", () => {
    it("should subscribe to changes matching a JSONPath", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe("$.config.theme", listener)

      // Make a change to the matching path
      handle.change(draft => {
        draft.config.theme = "dark"
      })

      // Listener should have been called with value and getPath
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith(["dark"], expect.any(Function))

      unsubscribe()
    })

    it("should provide the current value of the subscribed path", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      let receivedValue: unknown[] = []
      const unsubscribe = handle.subscribe("$.config.theme", value => {
        receivedValue = value
      })

      // Make a change to the matching path
      handle.change(draft => {
        draft.config.theme = "dark"
      })

      expect(receivedValue).toEqual(["dark"])

      // Make another change
      handle.change(draft => {
        draft.config.theme = "light"
      })

      expect(receivedValue).toEqual(["light"])

      unsubscribe()
    })

    it("should provide getPath helper to query other paths", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Set up initial data
      handle.change(draft => {
        draft.books.push({ title: "Book 1", price: 10 })
        draft.books.push({ title: "Book 2", price: 20 })
      })

      let queriedTitles: unknown[] = []
      const unsubscribe = handle.subscribe(
        "$.config.theme",
        (_value, getPath) => {
          // Use getPath to query a different path
          queriedTitles = getPath("$.books[*].title")
        },
      )

      // Trigger the subscription
      handle.change(draft => {
        draft.config.theme = "dark"
      })

      expect(queriedTitles).toEqual(["Book 1", "Book 2"])

      unsubscribe()
    })

    it("should not call listener for unrelated path changes", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe("$.config.theme", listener)

      // Make a change to a different path
      const books = doc.getList("books")
      books.insert(0, { title: "Test Book", price: 20 })
      doc.commit()

      // Listener should NOT have been called (different path)
      expect(listener).not.toHaveBeenCalled()

      unsubscribe()
    })

    it("should stop calling listener after unsubscribe", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe("$.config.theme", listener)

      // Unsubscribe immediately
      unsubscribe()

      // Make a change
      handle.change(draft => {
        draft.config.theme = "dark"
      })

      // Listener should not be called
      expect(listener).not.toHaveBeenCalled()
    })

    it("should work with array wildcard paths", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      let receivedTitles: unknown[] = []
      const unsubscribe = handle.subscribe("$.books[*].title", value => {
        receivedTitles = value
      })

      // Add a book
      handle.change(draft => {
        draft.books.push({ title: "New Book", price: 15 })
      })

      // Should receive the title
      expect(receivedTitles).toEqual(["New Book"])

      // Add another book
      handle.change(draft => {
        draft.books.push({ title: "Another Book", price: 25 })
      })

      // Should receive both titles
      expect(receivedTitles).toEqual(["New Book", "Another Book"])

      unsubscribe()
    })
  })

  describe("type safety", () => {
    it("should have correct types for regular subscription", () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // This should compile - listener receives LoroEventBatch
      handle.subscribe(event => {
        // TypeScript should know event has these properties
        const _by: "local" | "import" | "checkout" = event.by
        const _events = event.events
        expect(_by).toBeDefined()
        expect(_events).toBeDefined()
      })
    })

    it("should have correct types for JSONPath subscription", () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // This should compile - listener receives value and getPath
      handle.subscribe("$.config.theme", (value, getPath) => {
        // TypeScript should know value is unknown[]
        const _value: unknown[] = value
        // TypeScript should know getPath is a function
        const _result: unknown[] = getPath("$.other.path")
        expect(_value).toBeDefined()
        expect(_result).toBeDefined()
      })
    })
  })
})
