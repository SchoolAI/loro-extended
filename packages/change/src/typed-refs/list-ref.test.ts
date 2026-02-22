import { describe, expect, it } from "vitest"
import { change } from "../functional-helpers.js"
import { createTypedDoc, Shape } from "../index.js"

describe("ListRef", () => {
  describe("set via index", () => {
    it("should allow setting a plain object for a list item via index", () => {
      const schema = Shape.doc({
        users: Shape.list(
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

    it("should allow setting a primitive value via index", () => {
      const schema = Shape.doc({
        tags: Shape.list(Shape.plain.string()),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.tags.push("a")
        draft.tags.push("b")
        draft.tags.set(1, "c")
      })

      expect(doc.toJSON().tags).toEqual(["a", "c"])
    })
  })
})
