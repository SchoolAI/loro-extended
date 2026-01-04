import { loro } from "./loro.js"
import { describe, expect, it } from "vitest"
import { change } from "./functional-helpers.js"
import type { JsonPatch } from "./json-patch.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

describe("JSON Patch Integration", () => {
  describe("Basic Operations", () => {
    it("should handle add operations on map properties", () => {
      const schema = Shape.doc({
        metadata: Shape.struct({
          title: Shape.plain.string(),
          count: Shape.plain.number(),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      const patch: JsonPatch = [
        { op: "add", path: "/metadata/title", value: "Hello World" },
        { op: "add", path: "/metadata/count", value: 42 },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.metadata.title).toBe("Hello World")
      expect(result.metadata.count).toBe(42)
    })

    it("should handle remove operations on map properties", () => {
      const schema = Shape.doc({
        config: Shape.struct({
          theme: Shape.plain.string().placeholder("light"),
          debug: Shape.plain.boolean().placeholder(true),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      // First set some values
      change(typedDoc, draft => {
        draft.config.theme = "dark"
        draft.config.debug = false
      })

      const patch: JsonPatch = [{ op: "remove", path: "/config/debug" }]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.config.theme).toBe("dark")
      expect(result.config.debug).toBe(true) // Should fall back to empty state
    })

    it("should handle replace operations on map properties", () => {
      const schema = Shape.doc({
        settings: Shape.struct({
          language: Shape.plain.string().placeholder("en"),
          volume: Shape.plain.number().placeholder(50),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      // Set initial values
      change(typedDoc, draft => {
        draft.settings.language = "fr"
        draft.settings.volume = 75
      })

      const patch: JsonPatch = [
        { op: "replace", path: "/settings/language", value: "es" },
        { op: "replace", path: "/settings/volume", value: 100 },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.settings.language).toBe("es")
      expect(result.settings.volume).toBe(100)
    })
  })

  describe("List Operations", () => {
    it("should handle add operations on lists", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })

      const typedDoc = createTypedDoc(schema)

      const patch: JsonPatch = [
        { op: "add", path: "/items/0", value: "first" },
        { op: "add", path: "/items/1", value: "second" },
        { op: "add", path: "/items/1", value: "middle" }, // Insert in middle
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.items).toEqual(["first", "middle", "second"])
    })

    it("should handle remove operations on lists", () => {
      const schema = Shape.doc({
        tasks: Shape.list(Shape.plain.string()),
      })

      const typedDoc = createTypedDoc(schema)

      // Add initial items
      change(typedDoc, draft => {
        draft.tasks.push("task1")
        draft.tasks.push("task2")
        draft.tasks.push("task3")
      })

      const patch: JsonPatch = [
        { op: "remove", path: "/tasks/1" }, // Remove "task2"
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.tasks).toEqual(["task1", "task3"])
    })

    it("should handle replace operations on lists", () => {
      const schema = Shape.doc({
        numbers: Shape.list(Shape.plain.number()),
      })

      const typedDoc = createTypedDoc(schema)

      // Add initial items
      change(typedDoc, draft => {
        draft.numbers.push(1)
        draft.numbers.push(2)
        draft.numbers.push(3)
      })

      const patch: JsonPatch = [
        { op: "replace", path: "/numbers/1", value: 20 },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.numbers).toEqual([1, 20, 3])
    })
  })

  describe("CRDT Container Operations", () => {
    it("should work with text containers", () => {
      const schema = Shape.doc({
        title: Shape.text(),
        content: Shape.text(),
      })

      const typedDoc = createTypedDoc(schema)

      // Note: For text containers, we can't directly patch the text content
      // since it's a CRDT container. This test verifies the path navigation works
      // but the actual text manipulation should be done through text methods

      // doc.value returns TextRef objects with methods
      expect(typedDoc.title.toString()).toBe("")
      expect(typedDoc.content.toString()).toBe("")

      // toJSON returns plain strings
      expect(typedDoc.toJSON().title).toBe("")
      expect(typedDoc.toJSON().content).toBe("")
    })

    it("should work with counter containers", () => {
      const schema = Shape.doc({
        views: Shape.counter(),
        likes: Shape.counter(),
      })

      const typedDoc = createTypedDoc(schema)

      // Note: Similar to text, counters are CRDT containers
      // The path navigation should work, but actual counter operations
      // should use increment/decrement methods

      // doc.value returns CounterRef objects with methods
      expect(typedDoc.views.value).toBe(0)
      expect(typedDoc.likes.value).toBe(0)

      // toJSON returns plain numbers
      expect(typedDoc.toJSON().views).toBe(0)
      expect(typedDoc.toJSON().likes).toBe(0)
    })
  })

  describe("Complex Nested Operations", () => {
    it("should handle deeply nested map structures", () => {
      const schema = Shape.doc({
        user: Shape.struct({
          profile: Shape.struct({
            name: Shape.plain.string(),
            settings: Shape.struct({
              theme: Shape.plain.string().placeholder("light"),
              notifications: Shape.plain.boolean().placeholder(true),
            }),
          }),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      const patch: JsonPatch = [
        { op: "add", path: "/user/profile/name", value: "Alice" },
        { op: "replace", path: "/user/profile/settings/theme", value: "dark" },
        {
          op: "replace",
          path: "/user/profile/settings/notifications",
          value: false,
        },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.user.profile.name).toBe("Alice")
      expect(result.user.profile.settings.theme).toBe("dark")
      expect(result.user.profile.settings.notifications).toBe(false)
    })

    it("should handle lists of objects", () => {
      const schema = Shape.doc({
        todos: Shape.list(
          Shape.plain.struct({
            id: Shape.plain.string(),
            text: Shape.plain.string(),
            completed: Shape.plain.boolean(),
          }),
        ),
      })

      const typedDoc = createTypedDoc(schema)

      const patch: JsonPatch = [
        {
          op: "add",
          path: "/todos/0",
          value: { id: "1", text: "Buy milk", completed: false },
        },
        {
          op: "add",
          path: "/todos/1",
          value: { id: "2", text: "Walk dog", completed: false },
        },
        {
          op: "replace",
          path: "/todos/1/completed",
          value: true,
        },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.todos).toHaveLength(2)
      expect(result.todos[0]).toEqual({
        id: "1",
        text: "Buy milk",
        completed: false,
      })
      expect(result.todos[1]).toEqual({
        id: "2",
        text: "Walk dog",
        completed: true,
      })
    })
  })

  describe("Move and Copy Operations", () => {
    it("should handle move operations", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })

      const typedDoc = createTypedDoc(schema)

      // Add initial items
      change(typedDoc, draft => {
        draft.items.push("first")
        draft.items.push("second")
        draft.items.push("third")
      })

      const patch: JsonPatch = [
        { op: "move", from: "/items/0", path: "/items/2" }, // Move "first" to end
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.items).toEqual(["second", "third", "first"])
    })

    it("should handle various move scenarios to prevent regressions", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })

      const typedDoc = createTypedDoc(schema)

      // Test move from 0 to 3 (move first item to end of 4-item list)
      change(typedDoc, draft => {
        draft.items.push("A")
        draft.items.push("B")
        draft.items.push("C")
        draft.items.push("D")
      })

      const patch1: JsonPatch = [
        { op: "move", from: "/items/0", path: "/items/3" },
      ]

      loro(typedDoc).applyPatch(patch1)
      const result1 = typedDoc.toJSON()
      expect(result1.items).toEqual(["B", "C", "D", "A"])

      // Reset for next test
      change(typedDoc, draft => {
        draft.items.delete(0, draft.items.length)
        draft.items.push("A")
        draft.items.push("B")
        draft.items.push("C")
        draft.items.push("D")
      })

      // Test move from 1 to 3 (move middle item to end)
      const patch2: JsonPatch = [
        { op: "move", from: "/items/1", path: "/items/3" },
      ]

      loro(typedDoc).applyPatch(patch2)
      const result2 = typedDoc.toJSON()
      expect(result2.items).toEqual(["A", "C", "D", "B"])
    })

    it("should handle copy operations", () => {
      const schema = Shape.doc({
        source: Shape.list(Shape.plain.string()),
        target: Shape.list(Shape.plain.string()),
      })

      const typedDoc = createTypedDoc(schema)

      // Add initial items
      change(typedDoc, draft => {
        draft.source.push("item1")
        draft.source.push("item2")
      })

      const patch: JsonPatch = [
        { op: "copy", from: "/source/0", path: "/target/0" },
        { op: "copy", from: "/source/1", path: "/target/1" },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.source).toEqual(["item1", "item2"])
      expect(result.target).toEqual(["item1", "item2"])
    })
  })

  describe("Test Operations", () => {
    it("should handle test operations that pass", () => {
      const schema = Shape.doc({
        config: Shape.struct({
          version: Shape.plain.string().placeholder("1.0.0"),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      change(typedDoc, draft => {
        draft.config.version = "2.0.0"
      })

      const patch: JsonPatch = [
        { op: "test", path: "/config/version", value: "2.0.0" },
        { op: "replace", path: "/config/version", value: "2.1.0" },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.config.version).toBe("2.1.0")
    })

    it("should throw on test operations that fail", () => {
      const schema = Shape.doc({
        config: Shape.struct({
          version: Shape.plain.string().placeholder("1.0.0"),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      const patch: JsonPatch = [
        { op: "test", path: "/config/version", value: "2.0.0" }, // This should fail
      ]

      expect(() => {
        loro(typedDoc).applyPatch(patch)
      }).toThrow("JSON Patch test failed at path: /config/version")
    })
  })

  describe("Path Prefix Support", () => {
    it("should support path prefixes for scoped operations", () => {
      const schema = Shape.doc({
        users: Shape.struct({
          alice: Shape.struct({
            name: Shape.plain.string(),
            email: Shape.plain.string(),
          }),
          bob: Shape.struct({
            name: Shape.plain.string(),
            email: Shape.plain.string(),
          }),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      // Apply patch with path prefix to scope operations to alice
      const patch: JsonPatch = [
        { op: "add", path: "/name", value: "Alice Smith" },
        { op: "add", path: "/email", value: "alice@example.com" },
      ]

      loro(typedDoc).applyPatch(patch, ["users", "alice"])
      const result = typedDoc.toJSON()

      expect(result.users.alice.name).toBe("Alice Smith")
      expect(result.users.alice.email).toBe("alice@example.com")
      expect(result.users.bob.name).toBe("") // Should be unchanged
    })
  })

  describe("Path Formats", () => {
    it("should handle JSON Pointer format paths", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          items: Shape.list(Shape.plain.string()),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      const patch: JsonPatch = [
        { op: "add", path: "/data/items/0", value: "first" },
        { op: "add", path: "/data/items/1", value: "second" },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.data.items).toEqual(["first", "second"])
    })

    it("should handle array format paths", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          items: Shape.list(Shape.plain.string()),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      const patch: JsonPatch = [
        { op: "add", path: ["data", "items", 0], value: "first" },
        { op: "add", path: ["data", "items", 1], value: "second" },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.data.items).toEqual(["first", "second"])
    })
  })

  describe("Error Handling", () => {
    it("should throw on invalid paths", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          value: Shape.plain.string(),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      const patch: JsonPatch = [
        { op: "add", path: "/nonexistent/path", value: "test" },
      ]

      expect(() => {
        loro(typedDoc).applyPatch(patch)
      }).toThrow("Cannot navigate to path segment: nonexistent")
    })

    it("should throw on invalid list indices", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })

      const typedDoc = createTypedDoc(schema)

      const patch: JsonPatch = [
        { op: "remove", path: "/items/5" }, // Index out of bounds
      ]

      expect(() => {
        loro(typedDoc).applyPatch(patch)
      }).toThrow("Index out of bound")
    })
  })

  describe("Integration with Existing Change System", () => {
    it("should work alongside regular change operations", () => {
      const schema = Shape.doc({
        counter: Shape.counter(),
        text: Shape.text(),
        data: Shape.struct({
          items: Shape.list(Shape.plain.string()),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      // Use regular change operations
      change(typedDoc, draft => {
        draft.counter.increment(5)
        draft.text.insert(0, "Hello")
      })

      // Then use JSON Patch
      const patch: JsonPatch = [
        { op: "add", path: "/data/items/0", value: "item1" },
        { op: "add", path: "/data/items/1", value: "item2" },
      ]

      loro(typedDoc).applyPatch(patch)
      const result = typedDoc.toJSON()

      expect(result.counter).toBe(5)
      expect(result.text).toBe("Hello")
      expect(result.data.items).toEqual(["item1", "item2"])
    })

    it("should maintain state across multiple patch applications", () => {
      const schema = Shape.doc({
        settings: Shape.struct({
          theme: Shape.plain.string().placeholder("light"),
          language: Shape.plain.string().placeholder("en"),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      // First patch
      const patch1: JsonPatch = [
        { op: "replace", path: "/settings/theme", value: "dark" },
      ]

      loro(typedDoc).applyPatch(patch1)

      // Second patch
      const patch2: JsonPatch = [
        { op: "replace", path: "/settings/language", value: "fr" },
      ]

      loro(typedDoc).applyPatch(patch2)
      const result = typedDoc.toJSON()

      expect(result.settings.theme).toBe("dark") // Should persist from first patch
      expect(result.settings.language).toBe("fr")
    })
  })
})

