import { describe, expect, it, vi } from "vitest"
import { change } from "./functional-helpers.js"
import {
  requiresGlobalSubscription,
  subscribeToPath,
} from "./path-subscription.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

describe("Path Subscription", () => {
  describe("requiresGlobalSubscription", () => {
    const nonMergeableDocShape = Shape.doc(
      {
        config: Shape.struct({ theme: Shape.plain.string() }),
        books: Shape.list(Shape.struct({ title: Shape.text() })),
        users: Shape.record(Shape.struct({ name: Shape.plain.string() })),
      },
      { mergeable: false },
    )

    const mergeableDocShape = Shape.doc({
      config: Shape.struct({ theme: Shape.plain.string() }),
      books: Shape.list(Shape.struct({ title: Shape.text() })),
      users: Shape.record(Shape.struct({ name: Shape.plain.string() })),
    }) // mergeable: true by default

    it("should return false for non-mergeable docs (any path)", () => {
      // Any path in non-mergeable docs can use JSONPath
      expect(
        requiresGlobalSubscription(
          [
            { type: "property", key: "config" },
            { type: "property", key: "theme" },
          ],
          nonMergeableDocShape,
          false,
        ),
      ).toBe(false)

      expect(
        requiresGlobalSubscription(
          [
            { type: "property", key: "users" },
            { type: "key", key: "alice" },
            { type: "property", key: "name" },
          ],
          nonMergeableDocShape,
          false,
        ),
      ).toBe(false)
    })

    it("should return false for list paths in mergeable docs", () => {
      // Lists keep hierarchical structure even in mergeable mode
      expect(
        requiresGlobalSubscription(
          [{ type: "property", key: "books" }],
          mergeableDocShape,
          true,
        ),
      ).toBe(false)

      expect(
        requiresGlobalSubscription(
          [{ type: "property", key: "books" }, { type: "each" }],
          mergeableDocShape,
          true,
        ),
      ).toBe(false)

      expect(
        requiresGlobalSubscription(
          [
            { type: "property", key: "books" },
            { type: "index", index: 0 },
          ],
          mergeableDocShape,
          true,
        ),
      ).toBe(false)
    })

    it("should return true when path enters struct in mergeable mode", () => {
      // Entering struct's child in mergeable mode = flattening boundary
      expect(
        requiresGlobalSubscription(
          [
            { type: "property", key: "config" },
            { type: "property", key: "theme" },
          ],
          mergeableDocShape,
          true,
        ),
      ).toBe(true)
    })

    it("should return true when path enters record in mergeable mode", () => {
      // Entering record's values in mergeable mode = flattening boundary
      expect(
        requiresGlobalSubscription(
          [
            { type: "property", key: "users" },
            { type: "key", key: "alice" },
          ],
          mergeableDocShape,
          true,
        ),
      ).toBe(true)

      expect(
        requiresGlobalSubscription(
          [{ type: "property", key: "users" }, { type: "each" }],
          mergeableDocShape,
          true,
        ),
      ).toBe(true)
    })

    it("should return false for top-level property only in mergeable mode", () => {
      // Just accessing the top-level container, not entering it
      expect(
        requiresGlobalSubscription(
          [{ type: "property", key: "config" }],
          mergeableDocShape,
          true,
        ),
      ).toBe(false)

      expect(
        requiresGlobalSubscription(
          [{ type: "property", key: "users" }],
          mergeableDocShape,
          true,
        ),
      ).toBe(false)
    })
  })

  describe("subscribeToPath", () => {
    describe("with non-mergeable docs (subscribeJsonpath path)", () => {
      const DocSchema = Shape.doc(
        {
          config: Shape.struct({ theme: Shape.plain.string() }),
          books: Shape.list(
            Shape.struct({
              title: Shape.text(),
              price: Shape.plain.number(),
            }),
          ),
          users: Shape.record(Shape.struct({ name: Shape.plain.string() })),
        },
        { mergeable: false },
      )

      it("should subscribe to simple property path", () => {
        const doc = createTypedDoc(DocSchema)
        const listener = vi.fn()

        change(doc, d => {
          d.config.theme = "light"
        })

        const unsubscribe = subscribeToPath(doc, p => p.config.theme, listener)

        change(doc, d => {
          d.config.theme = "dark"
        })

        expect(listener).toHaveBeenCalledWith("dark")
        expect(listener).toHaveBeenCalledTimes(1)

        unsubscribe()
      })

      it("should return array for wildcard paths", () => {
        const doc = createTypedDoc(DocSchema)
        let titles: string[] = []

        const unsubscribe = subscribeToPath(
          doc,
          p => p.books.$each.title,
          value => {
            titles = value
          },
        )

        change(doc, d => {
          d.books.push({ title: "Book 1", price: 10 })
          d.books.push({ title: "Book 2", price: 20 })
        })

        expect(titles).toEqual(["Book 1", "Book 2"])

        unsubscribe()
      })

      it("should subscribe to specific array index", () => {
        const doc = createTypedDoc(DocSchema)
        let firstTitle: string | undefined

        change(doc, d => {
          d.books.push({ title: "First", price: 10 })
          d.books.push({ title: "Second", price: 20 })
        })

        const unsubscribe = subscribeToPath(
          doc,
          p => p.books.$first.title,
          value => {
            firstTitle = value
          },
        )

        change(doc, d => {
          d.books.get(0)?.title.delete(0, 5)
          d.books.get(0)?.title.insert(0, "Updated")
        })

        expect(firstTitle).toBe("Updated")

        unsubscribe()
      })

      it("should subscribe to $key on records", () => {
        const doc = createTypedDoc(DocSchema)
        let aliceName: string | undefined

        const unsubscribe = subscribeToPath(
          doc,
          p => p.users.$key("alice").name,
          value => {
            aliceName = value
          },
        )

        change(doc, d => {
          d.users.set("alice", { name: "Alice Smith" })
        })

        expect(aliceName).toBe("Alice Smith")

        unsubscribe()
      })

      it("should not fire callback when value unchanged", () => {
        const doc = createTypedDoc(DocSchema)
        const listener = vi.fn()

        change(doc, d => {
          d.config.theme = "light"
        })

        const unsubscribe = subscribeToPath(doc, p => p.config.theme, listener)

        // Change something else
        change(doc, d => {
          d.books.push({ title: "New Book", price: 15 })
        })

        // Should not fire because config.theme didn't change
        expect(listener).not.toHaveBeenCalled()

        unsubscribe()
      })

      it("should stop firing after unsubscribe", () => {
        const doc = createTypedDoc(DocSchema)
        const listener = vi.fn()

        const unsubscribe = subscribeToPath(doc, p => p.config.theme, listener)

        change(doc, d => {
          d.config.theme = "dark"
        })
        expect(listener).toHaveBeenCalledTimes(1)

        unsubscribe()
        listener.mockClear()

        change(doc, d => {
          d.config.theme = "light"
        })
        expect(listener).not.toHaveBeenCalled()
      })
    })

    describe("with mergeable docs (global subscription fallback)", () => {
      const DocSchema = Shape.doc({
        config: Shape.struct({ theme: Shape.plain.string() }),
        users: Shape.record(Shape.struct({ name: Shape.plain.string() })),
        title: Shape.text(),
      }) // mergeable: true by default

      it("should subscribe to struct path using global subscription", () => {
        const doc = createTypedDoc(DocSchema)
        let theme: string | undefined

        const unsubscribe = subscribeToPath(
          doc,
          p => p.config.theme,
          value => {
            theme = value
          },
        )

        change(doc, d => {
          d.config.theme = "dark"
        })

        expect(theme).toBe("dark")

        unsubscribe()
      })

      it("should subscribe to record path using global subscription", () => {
        const doc = createTypedDoc(DocSchema)
        let aliceName: string | undefined

        const unsubscribe = subscribeToPath(
          doc,
          p => p.users.$key("alice").name,
          value => {
            aliceName = value
          },
        )

        change(doc, d => {
          d.users.set("alice", { name: "Alice Smith" })
        })

        expect(aliceName).toBe("Alice Smith")

        unsubscribe()
      })

      it("should not fire callback when value unchanged (mergeable)", () => {
        const doc = createTypedDoc(DocSchema)
        const listener = vi.fn()

        change(doc, d => {
          d.users.set("alice", { name: "Alice" })
        })

        const unsubscribe = subscribeToPath(
          doc,
          p => p.users.$key("alice").name,
          listener,
        )

        // Change something else
        change(doc, d => {
          d.title.insert(0, "Hello")
        })

        // Should not fire because alice's name didn't change
        expect(listener).not.toHaveBeenCalled()

        unsubscribe()
      })

      it("should fire callback when value actually changes", () => {
        const doc = createTypedDoc(DocSchema)
        const listener = vi.fn()

        change(doc, d => {
          d.users.set("alice", { name: "Alice" })
        })

        const unsubscribe = subscribeToPath(
          doc,
          p => p.users.$key("alice").name,
          listener,
        )

        change(doc, d => {
          d.users.set("alice", { name: "Alice Updated" })
        })

        expect(listener).toHaveBeenCalledWith("Alice Updated")
        expect(listener).toHaveBeenCalledTimes(1)

        unsubscribe()
      })
    })

    describe("nested paths", () => {
      const DocSchema = Shape.doc(
        {
          books: Shape.list(
            Shape.struct({
              author: Shape.struct({
                name: Shape.plain.string(),
              }),
            }),
          ),
        },
        { mergeable: false },
      )

      it("should subscribe to deeply nested paths", () => {
        const doc = createTypedDoc(DocSchema)
        let authorNames: string[] = []

        const unsubscribe = subscribeToPath(
          doc,
          p => p.books.$each.author.name,
          value => {
            authorNames = value
          },
        )

        change(doc, d => {
          d.books.push({ author: { name: "Author 1" } })
          d.books.push({ author: { name: "Author 2" } })
        })

        expect(authorNames).toEqual(["Author 1", "Author 2"])

        unsubscribe()
      })
    })
  })
})
