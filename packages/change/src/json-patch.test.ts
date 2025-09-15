import { describe, expect, it } from "vitest"
import { createTypedDoc } from "./change.js"
import type { JsonPatch } from "./json-patch.js"
import { Shape } from "./shape.js"

describe("JSON Patch Integration", () => {
  describe("Basic Operations", () => {
    it("should handle add operations on map properties", () => {
      const schema = Shape.doc({
        metadata: Shape.map({
          title: Shape.plain.string(),
          count: Shape.plain.number(),
        }),
      })

      const emptyState = {
        metadata: {
          title: "",
          count: 0,
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      const patch: JsonPatch = [
        { op: "add", path: "/metadata/title", value: "Hello World" },
        { op: "add", path: "/metadata/count", value: 42 },
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.metadata.title).toBe("Hello World")
      expect(result.metadata.count).toBe(42)
    })

    it("should handle remove operations on map properties", () => {
      const schema = Shape.doc({
        config: Shape.map({
          theme: Shape.plain.string(),
          debug: Shape.plain.boolean(),
        }),
      })

      const emptyState = {
        config: {
          theme: "light",
          debug: true,
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // First set some values
      typedDoc.change(draft => {
        draft.config.set("theme", "dark")
        draft.config.set("debug", false)
      })

      const patch: JsonPatch = [{ op: "remove", path: "/config/debug" }]

      const result = typedDoc.applyPatch(patch)

      expect(result.config.theme).toBe("dark")
      expect(result.config.debug).toBe(true) // Should fall back to empty state
    })

    it("should handle replace operations on map properties", () => {
      const schema = Shape.doc({
        settings: Shape.map({
          language: Shape.plain.string(),
          volume: Shape.plain.number(),
        }),
      })

      const emptyState = {
        settings: {
          language: "en",
          volume: 50,
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Set initial values
      typedDoc.change(draft => {
        draft.settings.set("language", "fr")
        draft.settings.set("volume", 75)
      })

      const patch: JsonPatch = [
        { op: "replace", path: "/settings/language", value: "es" },
        { op: "replace", path: "/settings/volume", value: 100 },
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.settings.language).toBe("es")
      expect(result.settings.volume).toBe(100)
    })
  })

  describe("List Operations", () => {
    it("should handle add operations on lists", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })

      const emptyState = {
        items: [],
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      const patch: JsonPatch = [
        { op: "add", path: "/items/0", value: "first" },
        { op: "add", path: "/items/1", value: "second" },
        { op: "add", path: "/items/1", value: "middle" }, // Insert in middle
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.items).toEqual(["first", "middle", "second"])
    })

    it("should handle remove operations on lists", () => {
      const schema = Shape.doc({
        tasks: Shape.list(Shape.plain.string()),
      })

      const emptyState = {
        tasks: [],
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Add initial items
      typedDoc.change(draft => {
        draft.tasks.push("task1")
        draft.tasks.push("task2")
        draft.tasks.push("task3")
      })

      const patch: JsonPatch = [
        { op: "remove", path: "/tasks/1" }, // Remove "task2"
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.tasks).toEqual(["task1", "task3"])
    })

    it("should handle replace operations on lists", () => {
      const schema = Shape.doc({
        numbers: Shape.list(Shape.plain.number()),
      })

      const emptyState = {
        numbers: [],
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Add initial items
      typedDoc.change(draft => {
        draft.numbers.push(1)
        draft.numbers.push(2)
        draft.numbers.push(3)
      })

      const patch: JsonPatch = [
        { op: "replace", path: "/numbers/1", value: 20 },
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.numbers).toEqual([1, 20, 3])
    })
  })

  describe("CRDT Container Operations", () => {
    it("should work with text containers", () => {
      const schema = Shape.doc({
        title: Shape.text(),
        content: Shape.text(),
      })

      const emptyState = {
        title: "",
        content: "",
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Note: For text containers, we can't directly patch the text content
      // since it's a CRDT container. This test verifies the path navigation works
      // but the actual text manipulation should be done through text methods

      // This should work for setting up the structure
      const result = typedDoc.value
      expect(result.title).toBe("")
      expect(result.content).toBe("")
    })

    it("should work with counter containers", () => {
      const schema = Shape.doc({
        views: Shape.counter(),
        likes: Shape.counter(),
      })

      const emptyState = {
        views: 0,
        likes: 0,
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Note: Similar to text, counters are CRDT containers
      // The path navigation should work, but actual counter operations
      // should use increment/decrement methods

      const result = typedDoc.value
      expect(result.views).toBe(0)
      expect(result.likes).toBe(0)
    })
  })

  describe("Complex Nested Operations", () => {
    it("should handle deeply nested map structures", () => {
      const schema = Shape.doc({
        user: Shape.map({
          profile: Shape.map({
            name: Shape.plain.string(),
            settings: Shape.map({
              theme: Shape.plain.string(),
              notifications: Shape.plain.boolean(),
            }),
          }),
        }),
      })

      const emptyState = {
        user: {
          profile: {
            name: "",
            settings: {
              theme: "light",
              notifications: true,
            },
          },
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      const patch: JsonPatch = [
        { op: "add", path: "/user/profile/name", value: "Alice" },
        { op: "replace", path: "/user/profile/settings/theme", value: "dark" },
        {
          op: "replace",
          path: "/user/profile/settings/notifications",
          value: false,
        },
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.user.profile.name).toBe("Alice")
      expect(result.user.profile.settings.theme).toBe("dark")
      expect(result.user.profile.settings.notifications).toBe(false)
    })

    it("should handle lists of objects", () => {
      const schema = Shape.doc({
        todos: Shape.list(
          Shape.plain.object({
            id: Shape.plain.string(),
            text: Shape.plain.string(),
            completed: Shape.plain.boolean(),
          }),
        ),
      })

      const emptyState = {
        todos: [],
      }

      const typedDoc = createTypedDoc(schema, emptyState)

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

      const result = typedDoc.applyPatch(patch)

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

      const emptyState = {
        items: [],
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Add initial items
      typedDoc.change(draft => {
        draft.items.push("first")
        draft.items.push("second")
        draft.items.push("third")
      })

      const patch: JsonPatch = [
        { op: "move", from: "/items/0", path: "/items/2" }, // Move "first" to end
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.items).toEqual(["second", "third", "first"])
    })

    it("should handle various move scenarios to prevent regressions", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })

      const emptyState = {
        items: [],
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Test move from 0 to 3 (move first item to end of 4-item list)
      typedDoc.change(draft => {
        draft.items.push("A")
        draft.items.push("B")
        draft.items.push("C")
        draft.items.push("D")
      })

      const patch1: JsonPatch = [
        { op: "move", from: "/items/0", path: "/items/3" },
      ]

      const result1 = typedDoc.applyPatch(patch1)
      expect(result1.items).toEqual(["B", "C", "D", "A"])

      // Reset for next test
      typedDoc.change(draft => {
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

      const result2 = typedDoc.applyPatch(patch2)
      expect(result2.items).toEqual(["A", "C", "D", "B"])
    })

    it("should handle copy operations", () => {
      const schema = Shape.doc({
        source: Shape.list(Shape.plain.string()),
        target: Shape.list(Shape.plain.string()),
      })

      const emptyState = {
        source: [],
        target: [],
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Add initial items
      typedDoc.change(draft => {
        draft.source.push("item1")
        draft.source.push("item2")
      })

      const patch: JsonPatch = [
        { op: "copy", from: "/source/0", path: "/target/0" },
        { op: "copy", from: "/source/1", path: "/target/1" },
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.source).toEqual(["item1", "item2"])
      expect(result.target).toEqual(["item1", "item2"])
    })
  })

  describe("Test Operations", () => {
    it("should handle test operations that pass", () => {
      const schema = Shape.doc({
        config: Shape.map({
          version: Shape.plain.string(),
        }),
      })

      const emptyState = {
        config: {
          version: "1.0.0",
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      typedDoc.change(draft => {
        draft.config.set("version", "2.0.0")
      })

      const patch: JsonPatch = [
        { op: "test", path: "/config/version", value: "2.0.0" },
        { op: "replace", path: "/config/version", value: "2.1.0" },
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.config.version).toBe("2.1.0")
    })

    it("should throw on test operations that fail", () => {
      const schema = Shape.doc({
        config: Shape.map({
          version: Shape.plain.string(),
        }),
      })

      const emptyState = {
        config: {
          version: "1.0.0",
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      const patch: JsonPatch = [
        { op: "test", path: "/config/version", value: "2.0.0" }, // This should fail
      ]

      expect(() => {
        typedDoc.applyPatch(patch)
      }).toThrow("JSON Patch test failed at path: /config/version")
    })
  })

  describe("Path Prefix Support", () => {
    it("should support path prefixes for scoped operations", () => {
      const schema = Shape.doc({
        users: Shape.map({
          alice: Shape.map({
            name: Shape.plain.string(),
            email: Shape.plain.string(),
          }),
          bob: Shape.map({
            name: Shape.plain.string(),
            email: Shape.plain.string(),
          }),
        }),
      })

      const emptyState = {
        users: {
          alice: {
            name: "",
            email: "",
          },
          bob: {
            name: "",
            email: "",
          },
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Apply patch with path prefix to scope operations to alice
      const patch: JsonPatch = [
        { op: "add", path: "/name", value: "Alice Smith" },
        { op: "add", path: "/email", value: "alice@example.com" },
      ]

      const result = typedDoc.applyPatch(patch, ["users", "alice"])

      expect(result.users.alice.name).toBe("Alice Smith")
      expect(result.users.alice.email).toBe("alice@example.com")
      expect(result.users.bob.name).toBe("") // Should be unchanged
    })
  })

  describe("Path Formats", () => {
    it("should handle JSON Pointer format paths", () => {
      const schema = Shape.doc({
        data: Shape.map({
          items: Shape.list(Shape.plain.string()),
        }),
      })

      const emptyState = {
        data: {
          items: [],
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      const patch: JsonPatch = [
        { op: "add", path: "/data/items/0", value: "first" },
        { op: "add", path: "/data/items/1", value: "second" },
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.data.items).toEqual(["first", "second"])
    })

    it("should handle array format paths", () => {
      const schema = Shape.doc({
        data: Shape.map({
          items: Shape.list(Shape.plain.string()),
        }),
      })

      const emptyState = {
        data: {
          items: [],
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      const patch: JsonPatch = [
        { op: "add", path: ["data", "items", 0], value: "first" },
        { op: "add", path: ["data", "items", 1], value: "second" },
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.data.items).toEqual(["first", "second"])
    })
  })

  describe("Error Handling", () => {
    it("should throw on invalid paths", () => {
      const schema = Shape.doc({
        data: Shape.map({
          value: Shape.plain.string(),
        }),
      })

      const emptyState = {
        data: {
          value: "",
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      const patch: JsonPatch = [
        { op: "add", path: "/nonexistent/path", value: "test" },
      ]

      expect(() => {
        typedDoc.applyPatch(patch)
      }).toThrow("Cannot navigate to path segment: nonexistent")
    })

    it("should throw on invalid list indices", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })

      const emptyState = {
        items: [],
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      const patch: JsonPatch = [
        { op: "remove", path: "/items/5" }, // Index out of bounds
      ]

      expect(() => {
        typedDoc.applyPatch(patch)
      }).toThrow("Index out of bound")
    })
  })

  describe("Integration with Existing Change System", () => {
    it("should work alongside regular change operations", () => {
      const schema = Shape.doc({
        counter: Shape.counter(),
        text: Shape.text(),
        data: Shape.map({
          items: Shape.list(Shape.plain.string()),
        }),
      })

      const emptyState = {
        counter: 0,
        text: "",
        data: {
          items: [],
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // Use regular change operations
      typedDoc.change(draft => {
        draft.counter.increment(5)
        draft.text.insert(0, "Hello")
      })

      // Then use JSON Patch
      const patch: JsonPatch = [
        { op: "add", path: "/data/items/0", value: "item1" },
        { op: "add", path: "/data/items/1", value: "item2" },
      ]

      const result = typedDoc.applyPatch(patch)

      expect(result.counter).toBe(5)
      expect(result.text).toBe("Hello")
      expect(result.data.items).toEqual(["item1", "item2"])
    })

    it("should maintain state across multiple patch applications", () => {
      const schema = Shape.doc({
        settings: Shape.map({
          theme: Shape.plain.string(),
          language: Shape.plain.string(),
        }),
      })

      const emptyState = {
        settings: {
          theme: "light",
          language: "en",
        },
      }

      const typedDoc = createTypedDoc(schema, emptyState)

      // First patch
      const patch1: JsonPatch = [
        { op: "replace", path: "/settings/theme", value: "dark" },
      ]

      typedDoc.applyPatch(patch1)

      // Second patch
      const patch2: JsonPatch = [
        { op: "replace", path: "/settings/language", value: "fr" },
      ]

      const result = typedDoc.applyPatch(patch2)

      expect(result.settings.theme).toBe("dark") // Should persist from first patch
      expect(result.settings.language).toBe("fr")
    })
  })
})
