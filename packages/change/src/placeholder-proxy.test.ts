import { describe, expect, it } from "vitest"
import { createPlaceholderProxy } from "./placeholder-proxy.js"

describe("createPlaceholderProxy", () => {
  it("should allow .toJSON() on root object", () => {
    const placeholder = { foo: "bar" }
    const proxy = createPlaceholderProxy(placeholder)

    // @ts-expect-error
    expect(proxy.toJSON()).toBe(placeholder)
  })

  it("should allow .toJSON() on nested objects", () => {
    const placeholder = { nested: { foo: "bar" } }
    const proxy = createPlaceholderProxy(placeholder)

    // @ts-expect-error
    expect(proxy.nested.toJSON()).toBe(placeholder.nested)
  })

  it("should allow .toJSON() on arrays", () => {
    const placeholder = { list: ["a", "b"] }
    const proxy = createPlaceholderProxy(placeholder)

    // @ts-expect-error
    expect(proxy.list.toJSON()).toBe(placeholder.list)
  })

  it("should allow .toJSON() on nested arrays", () => {
    const placeholder = { list: [{ id: 1 }] }
    const proxy = createPlaceholderProxy(placeholder)

    // @ts-expect-error
    expect(proxy.list[0].toJSON()).toBe(placeholder.list[0])
  })

  it("should be transparent for other properties", () => {
    const placeholder = { foo: "bar", list: [1, 2] }
    const proxy = createPlaceholderProxy(placeholder)

    expect(proxy.foo).toBe("bar")
    expect(proxy.list[0]).toBe(1)
    expect(proxy.list.length).toBe(2)
  })

  it("should maintain referential equality for wrapped proxies", () => {
    const placeholder = { nested: {} }
    const proxy = createPlaceholderProxy(placeholder)

    expect(proxy.nested).toBe(proxy.nested)
  })
})
