import { describe, expect, it } from "vitest"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

describe("Counter Draft Node", () => {
  const schema = Shape.doc({
    counter: Shape.counter(),
  })

  it("should return emptyState value without materializing the container", () => {
    const doc = createTypedDoc(schema, { counter: 10 })

    // Accessing the value should return emptyState
    expect(doc.value.counter).toBe(10)

    // Verify it is NOT materialized in the underlying doc
    // @ts-expect-error - getShallowValue is not yet in the type definition
    const shallow = doc.loroDoc.getShallowValue()
    expect(shallow.counter).toBeUndefined()
  })

  it("should materialize the container after modification", () => {
    const doc = createTypedDoc(schema, { counter: 10 })

    doc.change(draft => {
      draft.counter.increment(5)
    })

    // Value should be updated
    // Note: emptyState is NOT applied to the CRDT. It is only a read-time overlay.
    // When we modify the counter, we are modifying the underlying CRDT counter which starts at 0.
    // So 0 + 5 = 5. The emptyState (10) is lost once the container exists.
    expect(doc.value.counter).toBe(5)

    // Verify it IS materialized in the underlying doc
    // @ts-expect-error - getShallowValue is not yet in the type definition
    const shallow = doc.loroDoc.getShallowValue()
    expect(shallow.counter).toBeDefined()
  })

  it("should respect emptyState even if accessed multiple times", () => {
    const doc = createTypedDoc(schema, { counter: 10 })

    expect(doc.value.counter).toBe(10)
    expect(doc.value.counter).toBe(10)

    // Still not materialized
    // @ts-expect-error
    expect(doc.loroDoc.getShallowValue().counter).toBeUndefined()
  })
})
