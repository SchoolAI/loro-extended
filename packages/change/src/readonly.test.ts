import { describe, expect, it } from "vitest"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

describe("TypedDoc Readonly Mode", () => {
  const schema = Shape.doc({
    meta: Shape.map({
      count: Shape.plain.number(),
      title: Shape.plain.string(),
    }),
    list: Shape.list(Shape.plain.string()),
  })

  it("should read values correctly", () => {
    const doc = createTypedDoc(schema, {
      meta: { count: 0, title: "test" },
      list: [],
    })

    doc.change(d => {
      d.meta.count = 1
      d.meta.title = "updated"
      d.list.push("item1")
    })

    expect(doc.toJSON().meta.count).toBe(1)
    expect(doc.toJSON().meta.title).toBe("updated")
    expect(doc.toJSON().list[0]).toBe("item1")
  })

  it("should reflect updates immediately (live view)", () => {
    const doc = createTypedDoc(schema, {
      meta: { count: 0, title: "test" },
      list: [],
    })

    // Get a reference to the live view
    const liveMeta = doc.value.meta

    expect(liveMeta.count).toBe(0)

    doc.change(d => {
      d.meta.count = 5
    })

    // Should see the update without re-fetching doc.value
    expect(liveMeta.count).toBe(5)
  })

  it("should throw on mutation attempts", () => {
    const doc = createTypedDoc(schema, {
      meta: { count: 0, title: "test" },
      list: [],
    })

    const liveMeta = doc.value.meta as any
    const liveList = doc.value.list as any

    expect(() => {
      liveMeta.count = 10
    }).toThrow() // Proxy might not throw on set, but the underlying setter should

    // We don't strictly prevent adding new properties to the JS object if it's not a Proxy,
    // but we ensure defined properties are protected.
    // expect(() => {
    //   liveMeta.newProp = "fail"
    // }).toThrow()

    expect(() => {
      delete liveMeta.count
    }).toThrow()

    expect(() => {
      liveList.push("fail")
    }).toThrow()

    expect(() => {
      liveList[0] = "fail"
    }).toThrow()
  })

  it("should support toJSON for full serialization", () => {
    const doc = createTypedDoc(schema, {
      meta: { count: 1, title: "json" },
      list: [],
    })

    doc.change(d => {
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
