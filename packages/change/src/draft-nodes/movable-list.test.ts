import { describe, expect, it } from "vitest"
import { createTypedDoc, Shape } from "../index.js"

describe("MovableListDraftNode", () => {
  describe("set via index", () => {
    it("should allow setting a plain object for a list item via index", () => {
      const schema = Shape.doc({
        users: Shape.movableList(
          Shape.map({
            name: Shape.plain.string(),
          }),
        ),
      })

      const doc = createTypedDoc(schema, { users: [] })

      doc.change(draft => {
        draft.users.push({ name: "Alice" })

        // Update via index
        draft.users[0] = { name: "Bob" }
      })

      expect(doc.value.users[0]).toEqual({ name: "Bob" })
    })
  })
})
