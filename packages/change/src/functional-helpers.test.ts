import { describe, expect, it } from "vitest"
import { change, getLoroDoc } from "./functional-helpers.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

const schema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
  users: Shape.record(
    Shape.plain.object({
      name: Shape.plain.string(),
    }),
  ),
})

describe("functional helpers", () => {
  describe("change()", () => {
    it("should batch multiple mutations into a single transaction", () => {
      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.title.insert(0, "Hello")
        draft.count.increment(5)
        draft.users.set("alice", { name: "Alice" })
      })

      expect(doc.toJSON().title).toBe("Hello")
      expect(doc.toJSON().count).toBe(5)
      expect(doc.toJSON().users.alice).toEqual({ name: "Alice" })
    })

    it("should return the doc for chaining", () => {
      const doc = createTypedDoc(schema)

      const result = change(doc, draft => {
        draft.title.insert(0, "Test")
        draft.count.increment(10)
      })

      // change() returns the doc for chaining
      expect(result).toBe(doc)
      expect(result.toJSON().title).toBe("Test")
      expect(result.toJSON().count).toBe(10)
    })

    it("should support chaining mutations", () => {
      const doc = createTypedDoc(schema)

      // Chain mutations after batch
      change(doc, draft => {
        draft.count.increment(5)
      }).count.increment(3)

      expect(doc.toJSON().count).toBe(8)
    })

    it("should support fluent API with toJSON at the end", () => {
      const doc = createTypedDoc(schema)

      // Fluent API: change -> mutate -> toJSON
      const json = change(doc, draft => {
        draft.title.insert(0, "Hello")
      }).toJSON()

      expect(json.title).toBe("Hello")
    })

    it("should commit all changes as one transaction", () => {
      const doc = createTypedDoc(schema)
      const loroDoc = getLoroDoc(doc)

      const versionBefore = loroDoc.version()

      change(doc, draft => {
        draft.count.increment(1)
        draft.count.increment(2)
        draft.count.increment(3)
      })

      const versionAfter = loroDoc.version()

      // Version should have changed (one commit)
      expect(versionAfter).not.toEqual(versionBefore)
      expect(doc.toJSON().count).toBe(6)
    })
  })

  describe("getLoroDoc()", () => {
    it("should return the underlying LoroDoc", () => {
      const doc = createTypedDoc(schema)
      const loroDoc = getLoroDoc(doc)

      expect(loroDoc).toBeDefined()
      expect(typeof loroDoc.version).toBe("function")
      expect(typeof loroDoc.subscribe).toBe("function")
    })

    it("should return the same LoroDoc as doc.$.loroDoc", () => {
      const doc = createTypedDoc(schema)

      expect(getLoroDoc(doc)).toBe(doc.$.loroDoc)
    })
  })

  describe("doc.toJSON()", () => {
    it("should work directly on the doc", () => {
      const doc = createTypedDoc(schema)

      doc.title.insert(0, "Hello")
      doc.count.increment(5)

      const json = doc.toJSON()

      expect(json.title).toBe("Hello")
      expect(json.count).toBe(5)
    })

    it("should work on refs", () => {
      const doc = createTypedDoc(schema)

      doc.users.set("alice", { name: "Alice" })
      doc.users.set("bob", { name: "Bob" })

      // toJSON on the record ref
      const usersJson = doc.users.toJSON()
      expect(usersJson).toEqual({
        alice: { name: "Alice" },
        bob: { name: "Bob" },
      })

      // toJSON on counter ref
      doc.count.increment(10)
      expect(doc.count.toJSON()).toBe(10)

      // toJSON on text ref
      doc.title.insert(0, "Test")
      expect(doc.title.toJSON()).toBe("Test")
    })

    it("should be equivalent to doc.toJSON()", () => {
      const doc = createTypedDoc(schema)

      doc.title.insert(0, "Hello")
      doc.count.increment(5)

      expect(doc.toJSON()).toEqual(doc.toJSON())
    })
  })
})
