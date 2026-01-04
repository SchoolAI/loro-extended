import { describe, expect, it } from "vitest"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

/**
 * Tests for Grand Unified API v3 with Proxy-based TypedDoc
 *
 * This API provides direct schema access on the doc object:
 * - doc.count.increment(5) instead of doc.count.increment(5)
 * - doc.$.change() for batched mutations
 * - doc.toJSON() for serialization
 */
describe("Grand Unified API v3", () => {
  const schema = Shape.doc({
    title: Shape.text(),
    count: Shape.counter(),
    users: Shape.record(
      Shape.plain.struct({
        name: Shape.plain.string(),
      }),
    ),
    items: Shape.list(Shape.plain.string()),
  })

  describe("direct mutations (auto-commit)", () => {
    it("should auto-commit counter increments", () => {
      const doc = createTypedDoc(schema)
      doc.count.increment(5)
      expect(doc.toJSON().count).toBe(5)
    })

    it("should auto-commit counter decrements", () => {
      const doc = createTypedDoc(schema)
      doc.count.increment(10)
      doc.count.decrement(3)
      expect(doc.toJSON().count).toBe(7)
    })

    it("should auto-commit text inserts", () => {
      const doc = createTypedDoc(schema)
      doc.title.insert(0, "Hello")
      expect(doc.toJSON().title).toBe("Hello")
    })

    it("should auto-commit text updates", () => {
      const doc = createTypedDoc(schema)
      doc.title.insert(0, "Hello")
      doc.title.update("World")
      expect(doc.toJSON().title).toBe("World")
    })

    it("should auto-commit text deletes", () => {
      const doc = createTypedDoc(schema)
      doc.title.insert(0, "Hello World")
      doc.title.delete(0, 6)
      expect(doc.toJSON().title).toBe("World")
    })

    it("should auto-commit record sets", () => {
      const doc = createTypedDoc(schema)
      doc.users.set("alice", { name: "Alice" })
      expect(doc.toJSON().users.alice).toEqual({ name: "Alice" })
    })

    it("should auto-commit record deletes", () => {
      const doc = createTypedDoc(schema)
      doc.users.set("alice", { name: "Alice" })
      doc.users.set("bob", { name: "Bob" })
      doc.users.delete("alice")
      expect(doc.toJSON().users.alice).toBeUndefined()
      expect(doc.toJSON().users.bob).toEqual({ name: "Bob" })
    })

    it("should auto-commit list pushes", () => {
      const doc = createTypedDoc(schema)
      doc.items.push("first")
      doc.items.push("second")
      expect(doc.toJSON().items).toEqual(["first", "second"])
    })

    it("should auto-commit list inserts", () => {
      const doc = createTypedDoc(schema)
      doc.items.push("first")
      doc.items.push("third")
      doc.items.insert(1, "second")
      expect(doc.toJSON().items).toEqual(["first", "second", "third"])
    })

    it("should auto-commit list deletes", () => {
      const doc = createTypedDoc(schema)
      doc.items.push("first")
      doc.items.push("second")
      doc.items.push("third")
      doc.items.delete(1, 1)
      expect(doc.toJSON().items).toEqual(["first", "third"])
    })
  })

  describe("record has() method and 'in' operator", () => {
    it("should support .has() method", () => {
      const doc = createTypedDoc(schema)
      doc.users.set("alice", { name: "Alice" })
      expect(doc.users.has("alice")).toBe(true)
      expect(doc.users.has("bob")).toBe(false)
    })

    it("should support 'in' operator for records", () => {
      const doc = createTypedDoc(schema)
      doc.users.set("alice", { name: "Alice" })
      expect("alice" in doc.users).toBe(true)
      expect("bob" in doc.users).toBe(false)
    })

    it("should support 'in' operator after change()", () => {
      const doc = createTypedDoc(schema)
      doc.$.change(draft => {
        draft.users.set("alice", { name: "Alice" })
        draft.users.set("bob", { name: "Bob" })
      })
      expect("alice" in doc.users).toBe(true)
      expect("bob" in doc.users).toBe(true)
      expect("charlie" in doc.users).toBe(false)
    })
  })

  describe("batched mutations", () => {
    it("should batch all changes into one commit", () => {
      const doc = createTypedDoc(schema)

      // Track commits by checking version changes
      const versionBefore = doc.$.loroDoc.version()

      doc.$.change(draft => {
        draft.count.increment(1)
        draft.count.increment(2)
        draft.count.increment(3)
      })

      const versionAfter = doc.$.loroDoc.version()

      // Version should have changed
      expect(versionAfter).not.toEqual(versionBefore)
      expect(doc.toJSON().count).toBe(6)
    })

    it("should batch multiple different operations", () => {
      const doc = createTypedDoc(schema)

      doc.$.change(draft => {
        draft.title.insert(0, "Hello World")
        draft.count.increment(42)
        draft.users.set("alice", { name: "Alice" })
        draft.items.push("item1")
      })

      const result = doc.toJSON()
      expect(result.title).toBe("Hello World")
      expect(result.count).toBe(42)
      expect(result.users.alice).toEqual({ name: "Alice" })
      expect(result.items).toEqual(["item1"])
    })

    it("should return doc for chaining from change()", () => {
      const doc = createTypedDoc(schema)

      const result = doc.$.change(draft => {
        draft.title.insert(0, "Test")
        draft.count.increment(5)
      })

      // change() returns the doc for chaining
      expect(result).toBe(doc)
      expect(result.toJSON().title).toBe("Test")
      expect(result.toJSON().count).toBe(5)
    })

    it("should support chaining after change()", () => {
      const doc = createTypedDoc(schema)

      // Chain mutations after change
      doc.$.change(draft => {
        draft.count.increment(5)
      }).count.increment(3)

      expect(doc.toJSON().count).toBe(8)
    })
  })

  describe("API consistency", () => {
    it("should have same methods on doc and draft", () => {
      const doc = createTypedDoc(schema)

      // Both should have .has()
      expect(typeof doc.users.has).toBe("function")
      doc.$.change(draft => {
        expect(typeof draft.users.has).toBe("function")
      })

      // Both should have .keys()
      expect(typeof doc.users.keys).toBe("function")
      doc.$.change(draft => {
        expect(typeof draft.users.keys).toBe("function")
      })

      // Both should have .set()
      expect(typeof doc.users.set).toBe("function")
      doc.$.change(draft => {
        expect(typeof draft.users.set).toBe("function")
      })
    })

    it("should allow reading values on doc", () => {
      const doc = createTypedDoc(schema)

      // Set up some data
      doc.$.change(draft => {
        draft.title.insert(0, "Test Title")
        draft.count.increment(42)
        draft.users.set("alice", { name: "Alice" })
        draft.items.push("item1")
      })

      // Read via doc directly
      expect(doc.title.toString()).toBe("Test Title")
      expect(doc.count.value).toBe(42)
      expect(doc.users.has("alice")).toBe(true)
      expect(doc.items.length).toBe(1)
    })
  })

  describe("nested container mutations", () => {
    it("should auto-commit nested map mutations", () => {
      const nestedSchema = Shape.doc({
        article: Shape.struct({
          title: Shape.text(),
          metadata: Shape.struct({
            views: Shape.counter(),
            author: Shape.plain.string(),
          }),
        }),
      })

      const doc = createTypedDoc(nestedSchema)

      // Direct mutations on nested containers
      doc.article.title.insert(0, "My Article")
      doc.article.metadata.views.increment(100)
      doc.article.metadata.author = "John Doe"

      const result = doc.toJSON()
      expect(result.article.title).toBe("My Article")
      expect(result.article.metadata.views).toBe(100)
      expect(result.article.metadata.author).toBe("John Doe")
    })

    it("should auto-commit list of maps mutations", () => {
      const listMapSchema = Shape.doc({
        articles: Shape.list(
          Shape.struct({
            title: Shape.text(),
            views: Shape.counter(),
          }),
        ),
      })

      const doc = createTypedDoc(listMapSchema)

      // Push via batch first to create the structure
      doc.$.change(draft => {
        draft.articles.push({ title: "Article 1", views: 0 })
        draft.articles.push({ title: "Article 2", views: 0 })
      })

      // Then mutate directly
      doc.articles.get(0)?.title.update("Updated Article 1")
      doc.articles.get(0)?.views.increment(50)

      const result = doc.toJSON()
      expect(result.articles[0].title).toBe("Updated Article 1")
      expect(result.articles[0].views).toBe(50)
    })
  })

  describe("counter and text primitive coercion", () => {
    it("should support valueOf() on CounterRef", () => {
      const doc = createTypedDoc(schema)
      doc.count.increment(42)

      // valueOf() should return the number
      expect(doc.count.valueOf()).toBe(42)

      // Arithmetic should work via valueOf()
      expect(+doc.count).toBe(42)
    })

    it("should support toString() on TextRef", () => {
      const doc = createTypedDoc(schema)
      doc.title.insert(0, "Hello World")

      // toString() should return the string
      expect(doc.title.toString()).toBe("Hello World")

      // String concatenation should work
      expect(`Title: ${doc.title}`).toBe("Title: Hello World")
    })
  })

  describe("placeholder handling", () => {
    it("should return placeholder for unmaterialized counter", () => {
      const schemaWithPlaceholder = Shape.doc({
        count: Shape.counter(), // default placeholder is 0
      })

      const doc = createTypedDoc(schemaWithPlaceholder)

      // Before any mutations, should return placeholder
      expect(doc.count.value).toBe(0)
      expect(doc.toJSON().count).toBe(0)
    })

    it("should return placeholder for unmaterialized text via toJSON()", () => {
      const schemaWithPlaceholder = Shape.doc({
        title: Shape.text().placeholder("Default Title"),
      })

      const doc = createTypedDoc(schemaWithPlaceholder)

      // Before any container access, toJSON() should return placeholder
      expect(doc.toJSON().title).toBe("Default Title")

      // Accessing doc.title creates a TextRef but doesn't materialize
      // the container until we actually use it
      const ref = doc.title
      expect(doc.toJSON().title).toBe("Default Title") // Still placeholder

      // Calling toString() on the ref accesses the container, materializing it
      ref.toString()
      // Now the container exists in the CRDT with empty string
      // The overlay returns the actual CRDT value (empty string) since it exists
      expect(doc.toJSON().title).toBe("")

      // After mutation, the value changes
      ref.insert(0, "Hello")
      expect(doc.toJSON().title).toBe("Hello")
    })

    it("should return actual value after mutation", () => {
      const schemaWithPlaceholder = Shape.doc({
        count: Shape.counter(),
        title: Shape.text().placeholder("Default"),
      })

      const doc = createTypedDoc(schemaWithPlaceholder)

      doc.count.increment(10)
      doc.title.update("Custom Title")

      expect(doc.count.value).toBe(10)
      expect(doc.title.toString()).toBe("Custom Title")
    })
  })

  describe("multiple sequential mutations", () => {
    it("should handle many sequential auto-commit mutations", () => {
      const doc = createTypedDoc(schema)

      // Many sequential mutations
      for (let i = 0; i < 10; i++) {
        doc.count.increment(1)
      }

      expect(doc.toJSON().count).toBe(10)
    })

    it("should handle interleaved reads and writes", () => {
      const doc = createTypedDoc(schema)

      doc.count.increment(5)
      expect(doc.count.value).toBe(5)

      doc.count.increment(3)
      expect(doc.count.value).toBe(8)

      doc.count.decrement(2)
      expect(doc.count.value).toBe(6)
    })
  })

  describe("$ namespace", () => {
    it("should provide access to meta-operations via $", () => {
      const doc = createTypedDoc(schema)

      // $ should exist
      expect(doc.$).toBeDefined()

      // $ should have batch, toJSON, loroDoc, etc.
      expect(typeof doc.$.change).toBe("function")
      expect(typeof doc.toJSON).toBe("function")
      expect(doc.$.loroDoc).toBeDefined()
    })

    it("should not enumerate $ in Object.keys()", () => {
      const doc = createTypedDoc(schema)

      // $ should not appear in Object.keys()
      const keys = Object.keys(doc)
      expect(keys).not.toContain("$")

      // But schema keys should appear
      expect(keys).toContain("title")
      expect(keys).toContain("count")
      expect(keys).toContain("users")
      expect(keys).toContain("items")
    })

    it("should support 'in' operator for $", () => {
      const doc = createTypedDoc(schema)

      // $ should be accessible via 'in'
      expect("$" in doc).toBe(true)
    })
  })
})
