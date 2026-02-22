import { describe, expect, it } from "vitest"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

describe("Equality Check", () => {
  const schema = Shape.doc({
    counter: Shape.counter().placeholder(1),
  })

  it("should compare CounterRef.value to plain number", () => {
    const doc = createTypedDoc(schema)
    // doc.counter returns a CounterRef, use .value to get the number
    expect(doc.counter.get()).toEqual(1)
  })

  it("should compare equal using toJSON", () => {
    const doc = createTypedDoc(schema)
    expect(doc.toJSON()).toEqual({ counter: 1 })
  })

  it("should support valueOf for loose comparisons", () => {
    const doc = createTypedDoc(schema)
    // CounterRef has valueOf() so it can be used in arithmetic
    expect(doc.counter.valueOf()).toBe(1)
    expect(+doc.counter).toBe(1)
  })
})
