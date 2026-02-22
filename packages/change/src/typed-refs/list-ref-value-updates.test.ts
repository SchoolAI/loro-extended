import { describe, expect, it } from "vitest"
import { change, createTypedDoc, Shape, value } from "../index.js"

/**
 * Tests for List value updates across multiple change() calls.
 *
 * ListRefBase has a different caching pattern than RecordRef/StructRef:
 * - It caches items in itemCache
 * - The cache is cleared in finalizeTransaction() after each change()
 *
 * However, there may still be stale cache issues if:
 * 1. Items are accessed outside of change() (populating the cache)
 * 2. Items are modified in a change() (different list instance)
 * 3. Items are accessed again outside of change() (stale cache?)
 *
 * Note: Lists don't support direct item modification like records/structs.
 * To "update" an item, you typically delete and re-insert, or modify
 * nested container properties.
 */
describe("List value updates across change() calls", () => {
  describe("primitive value lists", () => {
    it("reads updated values after delete and insert", () => {
      const Schema = Shape.doc({
        numbers: Shape.list(Shape.plain.number()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.numbers.push(100)
        draft.numbers.push(200)
        draft.numbers.push(300)
      })
      expect(value(doc.numbers.get(0))).toBe(100)
      expect(value(doc.numbers.get(1))).toBe(200)
      expect(value(doc.numbers.get(2))).toBe(300)

      // Modify by deleting and inserting
      change(doc, draft => {
        draft.numbers.delete(1, 1) // Remove 200
        draft.numbers.insert(1, 999) // Insert 999 at position 1
      })
      expect(value(doc.numbers.get(0))).toBe(100)
      expect(value(doc.numbers.get(1))).toBe(999) // Should be 999, not 200
      expect(value(doc.numbers.get(2))).toBe(300)
    })

    it("reads correct values after multiple push operations", () => {
      const Schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.items.push("first")
      })
      expect(value(doc.items.get(0))).toBe("first")

      change(doc, draft => {
        draft.items.push("second")
      })
      expect(value(doc.items.get(0))).toBe("first")
      expect(value(doc.items.get(1))).toBe("second")

      change(doc, draft => {
        draft.items.push("third")
      })
      expect(value(doc.items.get(0))).toBe("first")
      expect(value(doc.items.get(1))).toBe("second")
      expect(value(doc.items.get(2))).toBe("third")
    })
  })

  describe("object value lists", () => {
    it("reads updated object values after modification", () => {
      const Schema = Shape.doc({
        items: Shape.list(
          Shape.plain.struct({
            name: Shape.plain.string(),
            value: Shape.plain.number(),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.items.push({ name: "item1", value: 100 })
      })

      // Access item outside of change() - this may populate cache
      const item0 = doc.items.get(0)
      const item0Value = value(item0)
      expect(item0Value?.name).toBe("item1")
      expect(item0Value?.value).toBe(100)

      // Modify by replacing the item
      change(doc, draft => {
        draft.items.delete(0, 1)
        draft.items.insert(0, { name: "updated", value: 999 })
      })

      // Read again - should see updated values
      const item0After = doc.items.get(0)
      const item0AfterValue = value(item0After)
      expect(item0AfterValue?.name).toBe("updated")
      expect(item0AfterValue?.value).toBe(999)
    })
  })

  describe("list of structs (container shapes)", () => {
    it("reads updated struct properties after modification", () => {
      const Schema = Shape.doc({
        users: Shape.list(
          Shape.struct({
            name: Shape.plain.string(),
            age: Shape.plain.number(),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.users.push({ name: "Alice", age: 30 })
      })

      // Access outside of change()
      expect(value(doc.users.get(0)?.name)).toBe("Alice")
      expect(value(doc.users.get(0)?.age)).toBe(30)

      // Modify the struct's properties in a new change()
      change(doc, draft => {
        const user = draft.users.get(0)
        if (user) {
          user.name = "Bob"
          user.age = 25
        }
      })

      // Read again - should see updated values
      // This tests if the cached StructRef returns stale values
      expect(value(doc.users.get(0)?.name)).toBe("Bob") // May fail due to StructRef cache
      expect(value(doc.users.get(0)?.age)).toBe(25) // May fail due to StructRef cache
    })

    it("handles multiple updates to same struct in list", () => {
      const Schema = Shape.doc({
        items: Shape.list(
          Shape.struct({
            count: Shape.plain.number(),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.items.push({ count: 0 })
      })

      // Multiple updates
      for (let i = 1; i <= 5; i++) {
        change(doc, draft => {
          const item = draft.items.get(0)
          if (item) {
            item.count = i
          }
        })
        expect(value(doc.items.get(0)?.count)).toBe(i) // May fail on i > 1
      }
    })
  })

  describe("toJSON() consistency", () => {
    it("reflects updates in toJSON()", () => {
      const Schema = Shape.doc({
        values: Shape.list(Shape.plain.number()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.values.push(1)
        draft.values.push(2)
      })
      expect(doc.toJSON().values).toEqual([1, 2])

      change(doc, draft => {
        draft.values.delete(0, 1)
        draft.values.insert(0, 99)
      })
      expect(doc.toJSON().values).toEqual([99, 2])
    })
  })

  describe("comparison with raw LoroDoc", () => {
    it("underlying CRDT operations work correctly", async () => {
      const { LoroDoc } = await import("loro-crdt")

      const doc = new LoroDoc()
      const list = doc.getList("items")

      list.push(100)
      doc.commit()
      expect(list.get(0)).toBe(100)

      list.delete(0, 1)
      list.insert(0, 999)
      doc.commit()
      expect(list.get(0)).toBe(999) // PASSES: raw Loro works fine
    })
  })
})
