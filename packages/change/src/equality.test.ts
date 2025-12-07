import { describe, expect, it } from "vitest"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

describe("Equality Check", () => {
  const schema = Shape.doc({
    counter: Shape.counter(),
  })

  it("should compare equal to plain object", () => {
    const doc = createTypedDoc(schema, { counter: 1 })
    expect(doc.value.counter).toEqual(1)
  })

  it("should compare equal using toJSON", () => {
    const doc = createTypedDoc(schema, { counter: 1 })
    expect(doc.toJSON()).toEqual({ counter: 1 })
  })
})
