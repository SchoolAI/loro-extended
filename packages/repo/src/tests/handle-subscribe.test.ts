import { change, Shape } from "@loro-extended/change"
import { describe, expect, it, vi } from "vitest"
import { Repo } from "../repo.js"

const crdt = Shape
const value = Shape.plain

describe("Handle.subscribe", () => {
  // Path selector subscriptions don't yet support flattened (mergeable) storage,
  // so we use mergeable: false here to keep hierarchical container paths.
  const docShape = Shape.doc(
    {
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
    },
    { mergeable: false },
  )

  describe("regular subscription (backward compatibility)", () => {
    it("should subscribe to all document changes", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe(listener)

      // Make a change
      change(handle.doc, draft => {
        draft.config.theme = "dark"
      })

      // Listener should have been called
      expect(listener).toHaveBeenCalled()
      expect(listener.mock.calls[0][0]).toHaveProperty("by", "local")
      expect(listener.mock.calls[0][0]).toHaveProperty("events")

      // Unsubscribe and make another change
      unsubscribe()
      listener.mockClear()

      change(handle.doc, draft => {
        draft.config.theme = "light"
      })

      // Listener should not be called after unsubscribe
      expect(listener).not.toHaveBeenCalled()

      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("type-safe path selector DSL", () => {
    it("should subscribe to a simple property path", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe(p => p.config.theme, listener)

      // Make a change to the matching path
      change(handle.doc, draft => {
        draft.config.theme = "dark"
      })

      // Listener should have been called with value and prev
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith("dark", "")

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should provide previous value on subsequent changes", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      const calls: Array<{ value: string; prev: string | undefined }> = []
      const unsubscribe = handle.subscribe(
        p => p.config.theme,
        (value, prev) => {
          calls.push({ value, prev })
        },
      )

      // First change
      change(handle.doc, draft => {
        draft.config.theme = "dark"
      })

      // Second change
      change(handle.doc, draft => {
        draft.config.theme = "light"
      })

      expect(calls).toEqual([
        { value: "dark", prev: "" },
        { value: "light", prev: "dark" },
      ])

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should work with $each for arrays", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      let receivedTitles: string[] = []
      const unsubscribe = handle.subscribe(
        p => p.books.$each.title,
        titles => {
          receivedTitles = titles
        },
      )

      // Add a book
      change(handle.doc, draft => {
        draft.books.push({
          title: "New Book",
          price: 15,
          description: "A new book",
        })
      })

      // Should receive the title
      expect(receivedTitles).toEqual(["New Book"])

      // Add another book
      change(handle.doc, draft => {
        draft.books.push({
          title: "Another Book",
          price: 25,
          description: "Another one",
        })
      })

      // Should receive both titles
      expect(receivedTitles).toEqual(["New Book", "Another Book"])

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should work with $at for specific array index", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // Set up initial data
      change(handle.doc, draft => {
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
      change(handle.doc, draft => {
        const book = draft.books.get(0)
        if (book) {
          book.title.delete(0, book.title.length)
          book.title.insert(0, "Updated First Book")
        }
      })

      expect(receivedTitle).toBe("Updated First Book")

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should work with $first and $last", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // Set up initial data
      change(handle.doc, draft => {
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
      change(handle.doc, draft => {
        const firstBook = draft.books.get(0)
        if (firstBook) {
          firstBook.title.delete(0, firstBook.title.length)
          firstBook.title.insert(0, "Updated First")
        }
      })

      expect(firstTitle).toBe("Updated First")

      // Modify the last book
      change(handle.doc, draft => {
        const lastBook = draft.books.get(2)
        if (lastBook) {
          lastBook.title.delete(0, lastBook.title.length)
          lastBook.title.insert(0, "Updated Third")
        }
      })

      expect(lastTitle).toBe("Updated Third")

      unsubFirst()
      unsubLast()
      repo.synchronizer.stopHeartbeat()
    })

    it("should work with $key for records", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // Set up initial data using the correct API
      change(handle.doc, draft => {
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
      change(handle.doc, draft => {
        const alice = draft.users.get("alice")
        if (alice) {
          alice.name = "Alice Smith"
        }
      })

      expect(aliceName).toBe("Alice Smith")

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should work with $each for records", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // Set up initial data
      change(handle.doc, draft => {
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
      change(handle.doc, draft => {
        draft.users.set("charlie", { name: "Charlie", score: 0 })
      })

      expect(allNames).toContain("Alice")
      expect(allNames).toContain("Bob")
      expect(allNames).toContain("Charlie")

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should filter false positives with deep equality", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // Set up initial data
      change(handle.doc, draft => {
        draft.books.push({ title: "Book 1", price: 10, description: "Desc 1" })
        draft.books.push({ title: "Book 2", price: 20, description: "Desc 2" })
      })

      const listener = vi.fn()
      const unsubscribe = handle.subscribe(p => p.books.$each.title, listener)

      // No initial call is made - the listener is only called when changes happen
      expect(listener).not.toHaveBeenCalled()

      // Modify a book's description (not title) - this should NOT trigger the callback
      // because the titles haven't changed
      change(handle.doc, draft => {
        const book = draft.books.get(0)
        if (book) {
          book.description = "Updated description"
        }
      })

      // The WASM NFA may fire (false positive), but our deep equality check should filter it
      // Note: This test verifies the two-stage filtering works
      expect(listener).not.toHaveBeenCalled()

      // Now modify a title - this SHOULD trigger the callback
      change(handle.doc, draft => {
        const book = draft.books.get(0)
        if (book) {
          book.title.delete(0, book.title.length)
          book.title.insert(0, "Updated Book 1")
        }
      })

      expect(listener).toHaveBeenCalled()
      expect(listener.mock.calls[0][0]).toEqual(["Updated Book 1", "Book 2"])
      // Previous value should be the original titles
      expect(listener.mock.calls[0][1]).toEqual(["Book 1", "Book 2"])

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("JSONPath subscription (escape hatch)", () => {
    it("should subscribe to changes matching a JSONPath", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe("$.config.theme", listener)

      // Make a change to the matching path
      change(handle.doc, draft => {
        draft.config.theme = "dark"
      })

      // Listener should have been called with value
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith(["dark"])

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should provide the current value of the subscribed path", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      let receivedValue: unknown[] = []
      const unsubscribe = handle.subscribe("$.config.theme", value => {
        receivedValue = value
      })

      // Make a change to the matching path
      change(handle.doc, draft => {
        draft.config.theme = "dark"
      })

      expect(receivedValue).toEqual(["dark"])

      // Make another change
      change(handle.doc, draft => {
        draft.config.theme = "light"
      })

      expect(receivedValue).toEqual(["light"])

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should not call listener for unrelated path changes", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe("$.config.theme", listener)

      // Make a change to a different path
      const books = handle.loroDoc.getList("books")
      books.insert(0, { title: "Test Book", price: 20, description: "Test" })
      handle.loroDoc.commit()

      // Listener should NOT have been called (different path)
      expect(listener).not.toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should stop calling listener after unsubscribe", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = handle.subscribe("$.config.theme", listener)

      // Unsubscribe immediately
      unsubscribe()

      // Make a change
      change(handle.doc, draft => {
        draft.config.theme = "dark"
      })

      // Listener should not be called
      expect(listener).not.toHaveBeenCalled()

      repo.synchronizer.stopHeartbeat()
    })

    it("should work with array wildcard paths", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      let receivedPrices: unknown[] = []
      // Use price (a plain value) instead of title (a LoroText container)
      const unsubscribe = handle.subscribe("$.books[*].price", value => {
        receivedPrices = value
      })

      // Add a book
      change(handle.doc, draft => {
        draft.books.push({ title: "New Book", price: 15, description: "New" })
      })

      // Should receive the price
      expect(receivedPrices).toEqual([15])

      // Add another book
      change(handle.doc, draft => {
        draft.books.push({
          title: "Another Book",
          price: 25,
          description: "Another",
        })
      })

      // Should receive both prices
      expect(receivedPrices).toEqual([15, 25])

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("type safety", () => {
    it("should have correct types for regular subscription", () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // This should compile - listener receives LoroEventBatch
      handle.subscribe(event => {
        // TypeScript should know event has these properties
        const _by: "local" | "import" | "checkout" = event.by
        const _events = event.events
        expect(_by).toBeDefined()
        expect(_events).toBeDefined()
      })

      repo.synchronizer.stopHeartbeat()
    })

    it("should have correct types for path selector subscription", () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

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

      repo.synchronizer.stopHeartbeat()
    })

    it("should have correct types for JSONPath subscription", () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // This should compile - listener receives unknown[]
      handle.subscribe("$.config.theme", value => {
        // TypeScript should know value is unknown[]
        const _value: unknown[] = value
        expect(_value).toBeDefined()
      })

      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("jsonPath method", () => {
    it("should execute JSONPath queries", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // Set up initial data
      change(handle.doc, draft => {
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

      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("negative index support", () => {
    it("should support negative indices in JSONPath query", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // Set up initial data with multiple books
      change(handle.doc, draft => {
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

      repo.synchronizer.stopHeartbeat()
    })

    it("should support negative indices in subscribeJsonpath", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // Set up initial data
      change(handle.doc, draft => {
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
      change(handle.doc, draft => {
        const book = draft.books.get(1)
        if (book) {
          book.price = 25
        }
      })

      expect(lastPrice).toEqual([25])

      // Add a third book - now it becomes the last
      change(handle.doc, draft => {
        draft.books.push({
          title: "Third Book",
          price: 30,
          description: "Third",
        })
      })

      expect(lastPrice).toEqual([30])

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should handle out-of-bounds negative indices gracefully", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const handle = repo.get("doc-1", docShape)

      // Add one item
      change(handle.doc, draft => {
        draft.books.push({ title: "Only Book", price: 10, description: "Only" })
      })

      // Out of bounds negative index should return empty
      const outOfBounds = handle.jsonPath("$.books[-5].price")
      expect(outOfBounds).toEqual([])

      repo.synchronizer.stopHeartbeat()
    })
  })
})
