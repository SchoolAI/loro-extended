import { describe, expect, it } from "vitest"
import { change, createTypedDoc, Shape, value } from "../index.js"

/**
 * Regression tests for Shape.record() value updates across multiple change() calls.
 *
 * These tests ensure that value shapes in records are always read fresh from the
 * underlying container, preventing stale cache issues when mutations occur in
 * separate change() transactions.
 *
 * Fix: RecordRef.getOrCreateRef() no longer caches value shapes - it always reads
 * from the container. Container shapes (handles) are still cached safely.
 */
describe("Record value updates across change() calls", () => {
  describe("updating existing keys", () => {
    it("updates value with .set() method", () => {
      const Schema = Shape.doc({
        input: Shape.record(Shape.plain.any()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.input.set("key1", 123)
      })
      expect(value(doc.input.get("key1"))).toBe(123)

      change(doc, draft => {
        draft.input.set("key1", 456)
      })
      expect(value(doc.input.get("key1"))).toBe(456)
    })

    it("updates value with indexed assignment", () => {
      const Schema = Shape.doc({
        input: Shape.record(Shape.plain.number()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.input.key1 = 100
      })
      expect(value(doc.input.key1)).toBe(100)

      change(doc, draft => {
        draft.input.key1 = 200
      })
      expect(value(doc.input.key1)).toBe(200)
    })

    it("handles multiple sequential updates to same key", () => {
      const Schema = Shape.doc({
        counter: Shape.record(Shape.plain.number()),
      })

      const doc = createTypedDoc(Schema)

      for (let i = 1; i <= 5; i++) {
        change(doc, draft => {
          draft.counter.set("count", i)
        })
        expect(value(doc.counter.get("count"))).toBe(i)
      }
    })
  })

  describe("deleting keys", () => {
    it("removes key after delete", () => {
      const Schema = Shape.doc({
        input: Shape.record(Shape.plain.any()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.input.set("key1", "hello")
      })
      expect(value(doc.input.get("key1"))).toBe("hello")

      change(doc, draft => {
        draft.input.delete("key1")
      })
      expect(doc.input.has("key1")).toBe(false)
      expect(value(doc.input.get("key1"))).toBeUndefined()
    })
  })

  describe("toJSON() consistency", () => {
    it("reflects updates in toJSON()", () => {
      const Schema = Shape.doc({
        input: Shape.record(Shape.plain.boolean()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.input.set("flag", false)
      })
      expect(doc.toJSON().input).toEqual({ flag: false })

      change(doc, draft => {
        draft.input.set("flag", true)
      })
      expect(doc.toJSON().input).toEqual({ flag: true })
    })
  })

  describe("edge cases", () => {
    it("handles setting same value then different value", () => {
      const Schema = Shape.doc({
        data: Shape.record(Shape.plain.number()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.data.set("x", 42)
      })

      change(doc, draft => {
        draft.data.set("x", 42)
      })

      change(doc, draft => {
        draft.data.set("x", 99)
      })

      expect(value(doc.data.get("x"))).toBe(99)
    })

    it("handles alternating boolean values", () => {
      const Schema = Shape.doc({
        flags: Shape.record(Shape.plain.boolean()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.flags.set("active", false)
      })
      expect(value(doc.flags.get("active"))).toBe(false)

      change(doc, draft => {
        draft.flags.set("active", true)
      })
      expect(value(doc.flags.get("active"))).toBe(true)

      change(doc, draft => {
        draft.flags.set("active", false)
      })
      expect(value(doc.flags.get("active"))).toBe(false)
    })

    it("handles null values", () => {
      const Schema = Shape.doc({
        nullable: Shape.record(Shape.plain.any()),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.nullable.set("value", "initial")
      })
      expect(value(doc.nullable.get("value"))).toBe("initial")

      change(doc, draft => {
        draft.nullable.set("value", null)
      })
      expect(value(doc.nullable.get("value"))).toBe(null)
    })

    it("handles reading before first change", () => {
      const Schema = Shape.doc({
        data: Shape.record(Shape.plain.any()),
      })

      const doc = createTypedDoc(Schema)

      expect(doc.data.get("key")).toBeUndefined()

      change(doc, draft => {
        draft.data.set("key", 100)
      })
      expect(value(doc.data.get("key"))).toBe(100)

      change(doc, draft => {
        draft.data.set("key", 200)
      })
      expect(value(doc.data.get("key"))).toBe(200)
    })
  })

  describe("raw LoroDoc comparison", () => {
    it("underlying CRDT operations work correctly", async () => {
      const { LoroDoc } = await import("loro-crdt")

      const doc = new LoroDoc()
      const map = doc.getMap("input")

      map.set("key", 123)
      doc.commit()
      expect(map.get("key")).toBe(123)

      map.set("key", 456)
      doc.commit()
      expect(map.get("key")).toBe(456)

      map.delete("key")
      doc.commit()
      expect(map.get("key")).toBeUndefined()
    })
  })
})
