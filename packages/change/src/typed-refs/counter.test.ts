import { describe, expect, it } from "vitest"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

describe("Counter Ref", () => {
  it("should return placeholder value without materializing the container", () => {
    const schema = Shape.doc({
      counter: Shape.counter().placeholder(10),
    })
    const doc = createTypedDoc(schema)

    // Accessing the value should return placeholder
    expect(doc.value.counter).toBe(10)

    // Verify it is NOT materialized in the underlying doc
    const shallow = doc.loroDoc.getShallowValue()
    expect(shallow.counter).toBeUndefined()
  })

  it("should materialize the container after modification", () => {
    const schema = Shape.doc({
      counter: Shape.counter().placeholder(10),
    })
    const doc = createTypedDoc(schema)

    doc.change(draft => {
      draft.counter.increment(5)
    })

    // Value should be updated
    // Note: placeholder is NOT applied to the CRDT. It is only a read-time overlay.
    // When we modify the counter, we are modifying the underlying CRDT counter which starts at 0.
    // So 0 + 5 = 5. The placeholder (10) is lost once the container exists.
    expect(doc.value.counter).toBe(5)

    // Verify it IS materialized in the underlying doc
    const shallow = doc.loroDoc.getShallowValue()
    expect(shallow.counter).toBeDefined()
  })

  it("should respect placeholder even if accessed multiple times", () => {
    const schema = Shape.doc({
      counter: Shape.counter().placeholder(10),
    })
    const doc = createTypedDoc(schema)

    expect(doc.value.counter).toBe(10)
    expect(doc.value.counter).toBe(10)

    // Still not materialized
    expect(doc.loroDoc.getShallowValue().counter).toBeUndefined()
  })
})
