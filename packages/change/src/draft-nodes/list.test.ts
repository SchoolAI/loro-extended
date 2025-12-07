import { describe, expect, it } from "vitest"
import { createTypedDoc, Shape } from "../index.js"

describe("ListDraftNode", () => {
  describe("set via index", () => {
    it("should allow setting a plain object for a list item via index", () => {
      const schema = Shape.doc({
        users: Shape.list(
          Shape.map({
            name: Shape.plain.string(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      doc.change(draft => {
        draft.users.push({ name: "Alice" })

        // Update via index
        draft.users[0] = { name: "Bob" }
      })

      expect(doc.toJSON().users[0]).toEqual({ name: "Bob" })
    })

    it("should allow setting a primitive value via index", () => {
      const schema = Shape.doc({
        tags: Shape.list(Shape.plain.string()),
      })

      const doc = createTypedDoc(schema)

      doc.change(draft => {
        draft.tags.push("a")
        draft.tags.push("b")
        draft.tags[1] = "c"
      })

      expect(doc.toJSON().tags).toEqual(["a", "c"])
    })
  })
})
