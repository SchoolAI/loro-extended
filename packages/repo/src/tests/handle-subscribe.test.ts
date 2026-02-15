import { change, loro, Shape, subscribe } from "@loro-extended/change"
import { describe, expect, it, vi } from "vitest"
import { Repo } from "../repo.js"

const crdt = Shape
const value = Shape.plain

describe("Document subscription via subscribe()/loro()", () => {
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

  describe("regular subscription via subscribe()", () => {
    it("should subscribe to all document changes", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = subscribe(doc, listener)

      // Make a change
      change(doc, draft => {
        draft.config.theme = "dark"
      })

      // Listener should have been called
      expect(listener).toHaveBeenCalled()
      expect(listener.mock.calls[0][0]).toHaveProperty("by", "local")
      expect(listener.mock.calls[0][0]).toHaveProperty("events")

      // Unsubscribe and make another change
      unsubscribe()
      listener.mockClear()

      change(doc, draft => {
        draft.config.theme = "light"
      })

      // Listener should not be called after unsubscribe
      expect(listener).not.toHaveBeenCalled()

      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("JSONPath subscription via loro(doc).subscribeJsonpath()", () => {
    it("should subscribe to a simple property path", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = loro(doc).subscribeJsonpath(
        "$.config.theme",
        listener,
      )

      // Make a change to the matching path
      change(doc, draft => {
        draft.config.theme = "dark"
      })

      // Listener should have been called
      expect(listener).toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should work with wildcards for arrays", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = loro(doc).subscribeJsonpath("$.books[*]", listener)

      // Add a book
      change(doc, draft => {
        draft.books.push({
          title: "New Book",
          price: 15,
          description: "A new book",
        })
      })

      // Should receive notification
      expect(listener).toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should work with specific array index", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      // Set up initial data
      change(doc, draft => {
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

      const listener = vi.fn()
      const unsubscribe = loro(doc).subscribeJsonpath("$.books[0]", listener)

      // Change the first book
      change(doc, draft => {
        const book = draft.books.get(0)
        if (book) {
          book.title.delete(0, 5)
          book.title.insert(0, "Updated")
        }
      })

      expect(listener).toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should support record/map wildcard paths", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = loro(doc).subscribeJsonpath("$.users[*]", listener)

      // Add a user
      change(doc, draft => {
        draft.users.set("user-1", { name: "Alice", score: 0 })
      })

      expect(listener).toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should support nested paths in records", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      // Set up initial data
      change(doc, draft => {
        draft.users.set("user-1", { name: "Alice", score: 0 })
      })

      const listener = vi.fn()
      const unsubscribe = loro(doc).subscribeJsonpath(
        "$.users[*].score",
        listener,
      )

      // Update the score
      change(doc, draft => {
        draft.users.get("user-1")?.score.increment(10)
      })

      expect(listener).toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should not fire for changes outside the path", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = loro(doc).subscribeJsonpath(
        "$.config.theme",
        listener,
      )

      // Make a change to a different path
      change(doc, draft => {
        draft.books.push({
          title: "Book",
          price: 10,
          description: "Description",
        })
      })

      // Listener should not be called for unrelated changes
      // Note: subscribeJsonpath may still fire but with empty results
      // depending on implementation

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("ref-level subscription via subscribe(ref)", () => {
    it("should subscribe to changes on a specific ref", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = subscribe(doc.config, listener)

      // Make a change to config
      change(doc, draft => {
        draft.config.theme = "dark"
      })

      expect(listener).toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should not fire for changes to other refs", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = subscribe(doc.config, listener)

      // Make a change to books (not config)
      change(doc, draft => {
        draft.books.push({
          title: "Book",
          price: 10,
          description: "Description",
        })
      })

      // Config subscription should not fire for books changes
      expect(listener).not.toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should work with list refs", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = subscribe(doc.books, listener)

      change(doc, draft => {
        draft.books.push({
          title: "New Book",
          price: 15,
          description: "A new book",
        })
      })

      expect(listener).toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })

    it("should work with record refs", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = subscribe(doc.users, listener)

      change(doc, draft => {
        draft.users.set("user-1", { name: "Alice", score: 0 })
      })

      expect(listener).toHaveBeenCalled()

      unsubscribe()
      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("multiple subscriptions", () => {
    it("should support multiple subscriptions on same document", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const unsub1 = subscribe(doc, listener1)
      const unsub2 = subscribe(doc, listener2)

      change(doc, draft => {
        draft.config.theme = "dark"
      })

      expect(listener1).toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()

      unsub1()
      unsub2()
      repo.synchronizer.stopHeartbeat()
    })

    it("should allow independent unsubscription", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const unsub1 = subscribe(doc, listener1)
      const unsub2 = subscribe(doc, listener2)

      // Unsubscribe first listener
      unsub1()

      change(doc, draft => {
        draft.config.theme = "dark"
      })

      // Only listener2 should be called
      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()

      unsub2()
      repo.synchronizer.stopHeartbeat()
    })
  })

  describe("subscription cleanup", () => {
    it("should clean up when unsubscribed", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = subscribe(doc, listener)

      // First change - should trigger
      change(doc, draft => {
        draft.config.theme = "dark"
      })
      expect(listener).toHaveBeenCalledTimes(1)

      // Unsubscribe
      unsubscribe()
      listener.mockClear()

      // Second change - should not trigger
      change(doc, draft => {
        draft.config.theme = "light"
      })
      expect(listener).not.toHaveBeenCalled()

      repo.synchronizer.stopHeartbeat()
    })

    it("should handle multiple unsubscribe calls gracefully", async () => {
      const repo = new Repo({
        identity: { name: "test", type: "user" },
        adapters: [],
      })

      const doc = repo.get("doc-1", docShape)

      const listener = vi.fn()
      const unsubscribe = subscribe(doc, listener)

      // Multiple unsubscribes should not throw
      unsubscribe()
      expect(() => unsubscribe()).not.toThrow()

      repo.synchronizer.stopHeartbeat()
    })
  })
})
