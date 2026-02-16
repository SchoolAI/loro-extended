import { describe, expect, it } from "vitest"
import { change, createTypedDoc, Shape, unwrap } from "../index.js"

/**
 * Tests for StructRef value updates across multiple change() calls.
 *
 * These tests verify that value shapes in structs are always read fresh from the
 * underlying container, preventing stale cache issues when mutations occur in
 * separate change() transactions.
 *
 * Outside change(), value shape properties return PlainValueRef objects.
 * Use unwrap() / value() to get the raw value for assertions.
 */
describe("Struct value updates across change() calls", () => {
  describe("updating existing properties", () => {
    it("updates value property via direct assignment", () => {
      const Schema = Shape.doc({
        config: Shape.struct({
          name: Shape.plain.string(),
          count: Shape.plain.number(),
        }),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.config.name = "initial"
        draft.config.count = 1
      })
      expect(unwrap(doc.config.name)).toBe("initial")
      expect(unwrap(doc.config.count)).toBe(1)

      // Second change - BUG: values stay at initial values
      change(doc, draft => {
        draft.config.name = "updated"
        draft.config.count = 2
      })
      expect(unwrap(doc.config.name)).toBe("updated") // FAILS: returns "initial"
      expect(unwrap(doc.config.count)).toBe(2) // FAILS: returns 1
    })

    it("handles multiple sequential updates to same property", () => {
      const Schema = Shape.doc({
        settings: Shape.struct({
          value: Shape.plain.number(),
        }),
      })

      const doc = createTypedDoc(Schema)

      for (let i = 1; i <= 5; i++) {
        change(doc, draft => {
          draft.settings.value = i
        })
        expect(unwrap(doc.settings.value)).toBe(i) // FAILS on i > 1
      }
    })

    it("updates boolean property", () => {
      const Schema = Shape.doc({
        flags: Shape.struct({
          enabled: Shape.plain.boolean(),
        }),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.flags.enabled = true
      })
      expect(unwrap(doc.flags.enabled)).toBe(true)

      change(doc, draft => {
        draft.flags.enabled = false
      })
      expect(unwrap(doc.flags.enabled)).toBe(false) // FAILS: returns true
    })
  })

  describe("nested structs", () => {
    it("updates value in nested struct", () => {
      const Schema = Shape.doc({
        outer: Shape.struct({
          inner: Shape.struct({
            value: Shape.plain.number(),
          }),
        }),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.outer.inner.value = 100
      })
      expect(unwrap(doc.outer.inner.value)).toBe(100)

      change(doc, draft => {
        draft.outer.inner.value = 200
      })
      expect(unwrap(doc.outer.inner.value)).toBe(200) // FAILS: returns 100
    })
  })

  describe("struct inside record", () => {
    it("updates value in struct that is a record value", () => {
      const Schema = Shape.doc({
        users: Shape.record(
          Shape.struct({
            name: Shape.plain.string(),
            age: Shape.plain.number(),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.users.user1 = { name: "Alice", age: 30 }
      })
      expect(unwrap(doc.users.user1?.name)).toBe("Alice")
      expect(unwrap(doc.users.user1?.age)).toBe(30)

      // Update the struct's value properties
      change(doc, draft => {
        const user = draft.users.get("user1")
        if (user) {
          user.name = "Bob"
          user.age = 25
        }
      })
      expect(unwrap(doc.users.user1?.name)).toBe("Bob") // FAILS: returns "Alice"
      expect(unwrap(doc.users.user1?.age)).toBe(25) // FAILS: returns 30
    })
  })

  describe("toJSON() consistency", () => {
    it("reflects updates in toJSON()", () => {
      const Schema = Shape.doc({
        data: Shape.struct({
          status: Shape.plain.string(),
        }),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.data.status = "pending"
      })
      expect(doc.toJSON().data).toEqual({ status: "pending" })

      change(doc, draft => {
        draft.data.status = "complete"
      })
      expect(doc.toJSON().data).toEqual({ status: "complete" })
    })
  })

  describe("reading before first change", () => {
    it("reading before any change should not cause stale cache", () => {
      const Schema = Shape.doc({
        config: Shape.struct({
          value: Shape.plain.number().placeholder(0),
        }),
      })

      const doc = createTypedDoc(Schema)

      // Read before any change - gets placeholder value via PlainValueRef
      expect(unwrap(doc.config.value)).toBe(0)

      // First set
      change(doc, draft => {
        draft.config.value = 100
      })
      expect(unwrap(doc.config.value)).toBe(100)

      // Second set - PlainValueRef reads fresh from the container
      change(doc, draft => {
        draft.config.value = 200
      })
      expect(unwrap(doc.config.value)).toBe(200)
    })
  })

  describe("comparison with raw LoroDoc", () => {
    it("underlying CRDT operations work correctly", async () => {
      const { LoroDoc } = await import("loro-crdt")

      const doc = new LoroDoc()
      const map = doc.getMap("config")

      map.set("value", 123)
      doc.commit()
      expect(map.get("value")).toBe(123)

      map.set("value", 456)
      doc.commit()
      expect(map.get("value")).toBe(456) // PASSES: raw Loro works fine
    })
  })
})
