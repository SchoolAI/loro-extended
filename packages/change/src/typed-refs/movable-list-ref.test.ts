import { describe, expect, it } from "vitest"
import { change } from "../functional-helpers.js"
import { createTypedDoc, Shape } from "../index.js"

describe("MovableListRef", () => {
  describe("set via index", () => {
    it("should allow setting a plain object for a list item via index", () => {
      const schema = Shape.doc({
        users: Shape.movableList(
          Shape.struct({
            name: Shape.plain.string(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.users.push({ name: "Alice" })

        // Update via .set() method
        draft.users.set(0, { name: "Bob" })
      })

      expect(doc.toJSON().users[0]).toEqual({ name: "Bob" })
    })
  })

  describe("move operation with container refs", () => {
    it("should return correct TextRef after moving items", () => {
      const schema = Shape.doc({
        todos: Shape.movableList(
          Shape.struct({
            id: Shape.plain.string(),
            content: Shape.text(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      // Add two items with different content
      change(doc, draft => {
        draft.todos.push({ id: "a", content: "Content A" })
        draft.todos.push({ id: "b", content: "Content B" })
      })

      // Access the TextRefs before move (this populates the cache)
      const contentRefAtIndex0BeforeMove = doc.todos.get(0)?.content
      const contentRefAtIndex1BeforeMove = doc.todos.get(1)?.content

      expect(contentRefAtIndex0BeforeMove?.toString()).toBe("Content A")
      expect(contentRefAtIndex1BeforeMove?.toString()).toBe("Content B")

      // Move item from index 0 to index 1
      change(doc, draft => {
        draft.todos.move(0, 1)
      })

      // Verify JSON is correct after move
      const json = doc.toJSON()
      expect(json.todos[0].id).toBe("b")
      expect(json.todos[0].content).toBe("Content B")
      expect(json.todos[1].id).toBe("a")
      expect(json.todos[1].content).toBe("Content A")

      // Access the TextRefs after move - this is where the bug manifests
      // The refs should now point to the items at their NEW indices
      const contentRefAtIndex0AfterMove = doc.todos.get(0)?.content
      const contentRefAtIndex1AfterMove = doc.todos.get(1)?.content

      // BUG: These fail because the cache is not invalidated after move()
      // Index 0 should now have "Content B", but cache returns stale "Content A"
      expect(contentRefAtIndex0AfterMove?.toString()).toBe("Content B")
      expect(contentRefAtIndex1AfterMove?.toString()).toBe("Content A")
    })

    it("should return correct StructRef fields after moving items", () => {
      const schema = Shape.doc({
        items: Shape.movableList(
          Shape.struct({
            name: Shape.text(),
            count: Shape.counter(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      // Add three items
      change(doc, draft => {
        draft.items.push({ name: "First", count: 1 })
        draft.items.push({ name: "Second", count: 2 })
        draft.items.push({ name: "Third", count: 3 })
      })

      // Access refs to populate cache
      expect(doc.items.get(0)?.name.toString()).toBe("First")
      expect(doc.items.get(1)?.name.toString()).toBe("Second")
      expect(doc.items.get(2)?.name.toString()).toBe("Third")

      // Move first item to end (index 0 -> index 2)
      change(doc, draft => {
        draft.items.move(0, 2)
      })

      // Verify the order via toJSON
      const json = doc.toJSON()
      expect(json.items.map((i: any) => i.name)).toEqual([
        "Second",
        "Third",
        "First",
      ])

      // BUG: These fail because cache is not updated after move
      expect(doc.items.get(0)?.name.toString()).toBe("Second")
      expect(doc.items.get(1)?.name.toString()).toBe("Third")
      expect(doc.items.get(2)?.name.toString()).toBe("First")
    })
  })
})
