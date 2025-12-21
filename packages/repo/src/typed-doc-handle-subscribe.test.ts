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
      crdt.struct({
        title: crdt.text(),
        price: value.number(),
        description: value.string(),
      }),
    ),
    config: crdt.struct({
      theme: value.string(),
    }),
    users: crdt.record(
      crdt.struct({
        name: value.string(),
        score: crdt.counter(),
      }),
    ),
  })

  const presenceShape = value.struct({
    cursor: value.struct({ x: value.number(), y: value.number() }),
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

  describe("type-safe path selector DSL", () => {
    it("should subscribe to a simple property path", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe(p => p.config.theme, listener)

      // Make a change to the matching path
      handle.change(draft => {
        draft.config.theme = "dark"
      })

      // Listener should have been called with value and prev
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith("dark", "")

      unsubscribe()
    })

    it("should provide previous value on subsequent changes", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      const calls: Array<{ value: string; prev: string | undefined }> = []
      const unsubscribe = handle.subscribe(
        p => p.config.theme,
        (value, prev) => {
          calls.push({ value, prev })
        },
      )

      // First change
      handle.change(draft => {
        draft.config.theme = "dark"
      })

      // Second change
      handle.change(draft => {
        draft.config.theme = "light"
      })

      expect(calls).toEqual([
        { value: "dark", prev: "" },
        { value: "light", prev: "dark" },
      ])

      unsubscribe()
    })

    it("should work with $each for arrays", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      let receivedTitles: string[] = []
      const unsubscribe = handle.subscribe(
        p => p.books.$each.title,
        titles => {
          receivedTitles = titles
        },
      )

      // Add a book
      handle.change(draft => {
        draft.books.push({
          title: "New Book",
          price: 15,
          description: "A new book",
        })
      })

      // Should receive the title
      expect(receivedTitles).toEqual(["New Book"])

      // Add another book
      handle.change(draft => {
        draft.books.push({
          title: "Another Book",
          price: 25,
          description: "Another one",
        })
      })

      // Should receive both titles
      expect(receivedTitles).toEqual(["New Book", "Another Book"])

      unsubscribe()
    })

    it("should work with $at for specific array index", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Set up initial data
      handle.change(draft => {
        draft.books.push({
          title: "First Book",
          price: 10,
          description: "First",
        })
        draft.books.push({
          title: "Second Book",
          price: 20,
          description: "Second",
        })
      })

      let receivedTitle: string | undefined
      const unsubscribe = handle.subscribe(
        p => p.books.$at(0).title,
        title => {
          receivedTitle = title
        },
      )

      // Modify the first book's title using the LoroText API
      handle.change(draft => {
        draft.books.get(0).title.delete(0, draft.books.get(0).title.length)
        draft.books.get(0).title.insert(0, "Updated First Book")
      })

      expect(receivedTitle).toBe("Updated First Book")

      unsubscribe()
    })

    it("should work with $first and $last", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Set up initial data
      handle.change(draft => {
        draft.books.push({
          title: "First Book",
          price: 10,
          description: "First",
        })
        draft.books.push({
          title: "Second Book",
          price: 20,
          description: "Second",
        })
        draft.books.push({
          title: "Third Book",
          price: 30,
          description: "Third",
        })
      })

      let firstTitle: string | undefined
      let lastTitle: string | undefined

      const unsubFirst = handle.subscribe(
        p => p.books.$first.title,
        title => {
          firstTitle = title
        },
      )
      const unsubLast = handle.subscribe(
        p => p.books.$last.title,
        title => {
          lastTitle = title
        },
      )

      // Modify the first book
      handle.change(draft => {
        const firstBook = draft.books.get(0)
        firstBook.title.delete(0, firstBook.title.length)
        firstBook.title.insert(0, "Updated First")
      })

      expect(firstTitle).toBe("Updated First")

      // Modify the last book
      handle.change(draft => {
        const lastBook = draft.books.get(2)
        lastBook.title.delete(0, lastBook.title.length)
        lastBook.title.insert(0, "Updated Third")
      })

      expect(lastTitle).toBe("Updated Third")

      unsubFirst()
      unsubLast()
    })

    it("should work with $key for records", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Set up initial data using the correct API
      handle.change(draft => {
        draft.users.set("alice", { name: "Alice", score: 0 })
        draft.users.set("bob", { name: "Bob", score: 0 })
      })

      let aliceName: string | undefined
      const unsubscribe = handle.subscribe(
        p => p.users.$key("alice").name,
        name => {
          aliceName = name
        },
      )

      // Modify Alice's name
      handle.change(draft => {
        draft.users.get("alice").name = "Alice Smith"
      })

      expect(aliceName).toBe("Alice Smith")

      unsubscribe()
    })

    it("should work with $each for records", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Set up initial data
      handle.change(draft => {
        draft.users.set("alice", { name: "Alice", score: 0 })
        draft.users.set("bob", { name: "Bob", score: 0 })
      })

      let allNames: string[] = []
      const unsubscribe = handle.subscribe(
        p => p.users.$each.name,
        names => {
          allNames = names
        },
      )

      // Add a new user
      handle.change(draft => {
        draft.users.set("charlie", { name: "Charlie", score: 0 })
      })

      expect(allNames).toContain("Alice")
      expect(allNames).toContain("Bob")
      expect(allNames).toContain("Charlie")

      unsubscribe()
    })

    it("should filter false positives with deep equality", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Set up initial data
      handle.change(draft => {
        draft.books.push({ title: "Book 1", price: 10, description: "Desc 1" })
        draft.books.push({ title: "Book 2", price: 20, description: "Desc 2" })
      })

      const listener = vi.fn()
      const unsubscribe = handle.subscribe(p => p.books.$each.title, listener)

      // No initial call is made - the listener is only called when changes happen
      expect(listener).not.toHaveBeenCalled()

      // Modify a book's description (not title) - this should NOT trigger the callback
      // because the titles haven't changed
      handle.change(draft => {
        draft.books.get(0).description = "Updated description"
      })

      // The WASM NFA may fire (false positive), but our deep equality check should filter it
      // Note: This test verifies the two-stage filtering works
      expect(listener).not.toHaveBeenCalled()

      // Now modify a title - this SHOULD trigger the callback
      handle.change(draft => {
        const book = draft.books.get(0)
        book.title.delete(0, book.title.length)
        book.title.insert(0, "Updated Book 1")
      })

      expect(listener).toHaveBeenCalled()
      expect(listener.mock.calls[0][0]).toEqual(["Updated Book 1", "Book 2"])
      // Previous value should be the original titles
      expect(listener.mock.calls[0][1]).toEqual(["Book 1", "Book 2"])

      unsubscribe()
    })
  })

  describe("JSONPath subscription (escape hatch)", () => {
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

      // Listener should have been called with value
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith(["dark"])

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

    it("should not call listener for unrelated path changes", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe("$.config.theme", listener)

      // Make a change to a different path
      const books = doc.getList("books")
      books.insert(0, { title: "Test Book", price: 20, description: "Test" })
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

      let receivedPrices: unknown[] = []
      // Use price (a plain value) instead of title (a LoroText container)
      const unsubscribe = handle.subscribe("$.books[*].price", value => {
        receivedPrices = value
      })

      // Add a book
      handle.change(draft => {
        draft.books.push({ title: "New Book", price: 15, description: "New" })
      })

      // Should receive the price
      expect(receivedPrices).toEqual([15])

      // Add another book
      handle.change(draft => {
        draft.books.push({
          title: "Another Book",
          price: 25,
          description: "Another",
        })
      })

      // Should receive both prices
      expect(receivedPrices).toEqual([15, 25])

      unsubscribe()
    })
  })

  describe("jsonPath method", () => {
    it("should execute JSONPath queries", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Set up initial data
      handle.change(draft => {
        draft.books.push({ title: "Book 1", price: 10, description: "Cheap" })
        draft.books.push({
          title: "Book 2",
          price: 50,
          description: "Expensive",
        })
      })

      // Query prices (plain values) instead of titles (LoroText containers)
      const allPrices = handle.jsonPath("$.books[*].price")
      expect(allPrices).toEqual([10, 50])
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

    it("should have correct types for path selector subscription", () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // This should compile - listener receives typed value and prev
      handle.subscribe(
        p => p.config.theme,
        (value, prev) => {
          // TypeScript should know value is string
          const _value: string = value
          // TypeScript should know prev is string | undefined
          const _prev: string | undefined = prev
          expect(_value).toBeDefined()
          expect(_prev).toBeDefined()
        },
      )

      // Array path should return array type
      handle.subscribe(
        p => p.books.$each.title,
        (titles, prev) => {
          // TypeScript should know titles is string[]
          const _titles: string[] = titles
          const _prev: string[] | undefined = prev
          expect(_titles).toBeDefined()
          expect(_prev).toBeDefined()
        },
      )
    })

    it("should have correct types for JSONPath subscription", () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // This should compile - listener receives unknown[]
      handle.subscribe("$.config.theme", value => {
        // TypeScript should know value is unknown[]
        const _value: unknown[] = value
        expect(_value).toBeDefined()
      })
    })
  })

  describe("negative index support", () => {
    it("should support negative indices in JSONPath query", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Set up initial data with multiple books
      handle.change(draft => {
        draft.books.push({
          title: "First Book",
          price: 10,
          description: "First",
        })
        draft.books.push({
          title: "Second Book",
          price: 20,
          description: "Second",
        })
        draft.books.push({
          title: "Third Book",
          price: 30,
          description: "Third",
        })
      })

      // Test negative index in JSONPath
      // Note: JSONPath returns raw Loro containers, so we need to check the structure
      const lastBook = handle.jsonPath("$.books[-1]")
      expect(lastBook).toHaveLength(1)
      // The result is a LoroMap, check it has the expected keys
      const lastBookObj = lastBook[0] as Record<string, unknown>
      expect(lastBookObj).toBeDefined()

      const lastPrice = handle.jsonPath("$.books[-1].price")
      expect(lastPrice).toEqual([30])

      const secondToLastPrice = handle.jsonPath("$.books[-2].price")
      expect(secondToLastPrice).toEqual([20])
    })

    it("should support negative indices in subscribeJsonpath", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Set up initial data
      handle.change(draft => {
        draft.books.push({
          title: "First Book",
          price: 10,
          description: "First",
        })
        draft.books.push({
          title: "Second Book",
          price: 20,
          description: "Second",
        })
      })

      let lastPrice: unknown[] = []
      const unsubscribe = handle.subscribe("$.books[-1].price", value => {
        lastPrice = value
      })

      // Modify the last book's price
      handle.change(draft => {
        draft.books.get(1).price = 25
      })

      expect(lastPrice).toEqual([25])

      // Add a third book - now it becomes the last
      handle.change(draft => {
        draft.books.push({
          title: "Third Book",
          price: 30,
          description: "Third",
        })
      })

      expect(lastPrice).toEqual([30])

      unsubscribe()
    })

    it("should handle out-of-bounds negative indices gracefully", async () => {
      const doc = new LoroDoc()
      const mockUntyped = createMockUntypedHandle(doc)
      const handle = new TypedDocHandle(mockUntyped, docShape, presenceShape)

      // Add one item
      handle.change(draft => {
        draft.books.push({ title: "Only Book", price: 10, description: "Only" })
      })

      // Out of bounds negative index should return empty
      const outOfBounds = handle.jsonPath("$.books[-5].price")
      expect(outOfBounds).toEqual([])
    })
  })
})
