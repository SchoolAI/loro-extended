import { describe, expect, it } from "vitest"
import { change } from "./functional-helpers.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

describe("TypedDoc Mutable Mode", () => {
  const schema = Shape.doc({
    meta: Shape.struct({
      count: Shape.plain.number(),
      title: Shape.plain.string(),
    }),
    list: Shape.list(Shape.plain.string()),
  })

  it("should read values correctly", () => {
    const doc = createTypedDoc(schema)

    change(doc, d => {
      d.meta.count = 1
      d.meta.title = "updated"
      d.list.push("item1")
    })

    expect(doc.toJSON().meta.count).toBe(1)
    expect(doc.toJSON().meta.title).toBe("updated")
    expect(doc.toJSON().list[0]).toBe("item1")
  })

  it("should reflect updates immediately (live view)", () => {
    const doc = createTypedDoc(schema)

    // Get a reference to the live view
    const liveMeta = doc.meta

    expect(liveMeta.count).toBe(0)

    change(doc, d => {
      d.meta.count = 5
    })

    // Should see the update without re-fetching doc.value
    expect(liveMeta.count).toBe(5)
  })

  it("should allow direct mutations via doc.value (auto-commit)", () => {
    const doc = createTypedDoc(schema)

    // Direct mutations on doc.value should work and auto-commit
    doc.meta.count = 10
    expect(doc.toJSON().meta.count).toBe(10)

    doc.list.push("item1")
    expect(doc.toJSON().list[0]).toBe("item1")

    doc.list.push("item2")
    expect(doc.toJSON().list).toEqual(["item1", "item2"])
  })

  it("should support change() for grouped mutations", () => {
    const doc = createTypedDoc(schema)

    change(doc, d => {
      d.meta.count = 1
      d.meta.title = "batched"
      d.list.push("a")
      d.list.push("b")
    })

    expect(doc.toJSON()).toEqual({
      meta: { count: 1, title: "batched" },
      list: ["a", "b"],
    })
  })

  it("should support toJSON for full serialization", () => {
    const doc = createTypedDoc(schema)

    change(doc, d => {
      d.meta.count = 1
      d.meta.title = "json"
      d.list.push("a")
      d.list.push("b")
    })

    const json = doc.toJSON()
    expect(json).toEqual({
      meta: { count: 1, title: "json" },
      list: ["a", "b"],
    })

    // Verify it's a plain object, not a proxy
    expect(json.meta).not.toHaveProperty("getOrCreateNode")
  })
})
