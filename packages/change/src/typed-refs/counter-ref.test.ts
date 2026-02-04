import { describe, expect, it } from "vitest"
import { change } from "../functional-helpers.js"
import { loro } from "../loro.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

describe("Counter Ref", () => {
  it("should return placeholder value without materializing the container (via toJSON)", () => {
    const schema = Shape.doc({
      counter: Shape.counter().placeholder(10),
    })
    const doc = createTypedDoc(schema)

    // Accessing the value via toJSON should return placeholder
    expect(doc.toJSON().counter).toBe(10)

    // Verify it is NOT materialized in the underlying doc
    const shallow = loro(doc).getShallowValue()
    expect(shallow.counter).toBeUndefined()
  })

  it("should return CounterRef from doc.value for direct mutations", () => {
    const schema = Shape.doc({
      counter: Shape.counter().placeholder(10),
    })
    const doc = createTypedDoc(schema)

    // doc.counter returns a CounterRef with methods
    const counterRef = doc.counter
    expect(typeof counterRef.increment).toBe("function")
    expect(typeof counterRef.decrement).toBe("function")
    expect(typeof counterRef.value).toBe("number")
  })

  it("should materialize the container after modification via doc.value", () => {
    const schema = Shape.doc({
      counter: Shape.counter().placeholder(10),
    })
    const doc = createTypedDoc(schema)

    // Direct mutation via doc.value (auto-commits)
    doc.counter.increment(5)

    // Value should be updated
    // Note: placeholder is NOT applied to the CRDT. It is only a read-time overlay.
    // When we modify the counter, we are modifying the underlying CRDT counter which starts at 0.
    // So 0 + 5 = 5. The placeholder (10) is lost once the container exists.
    expect(doc.toJSON().counter).toBe(5)
    expect(doc.counter.value).toBe(5)

    // Verify it IS materialized in the underlying doc
    const shallow = loro(doc).getShallowValue()
    expect(shallow.counter).toBeDefined()
  })

  it("should materialize the container after modification via change()", () => {
    const schema = Shape.doc({
      counter: Shape.counter().placeholder(10),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.counter.increment(5)
    })

    // Value should be updated (0 + 5 = 5)
    expect(doc.toJSON().counter).toBe(5)

    // Verify it IS materialized in the underlying doc
    const shallow = loro(doc).getShallowValue()
    expect(shallow.counter).toBeDefined()
  })

  it("should respect placeholder even if accessed multiple times (via toJSON)", () => {
    const schema = Shape.doc({
      counter: Shape.counter().placeholder(10),
    })
    const doc = createTypedDoc(schema)

    expect(doc.toJSON().counter).toBe(10)
    expect(doc.toJSON().counter).toBe(10)

    // Still not materialized
    expect(loro(doc).getShallowValue().counter).toBeUndefined()
  })
})
