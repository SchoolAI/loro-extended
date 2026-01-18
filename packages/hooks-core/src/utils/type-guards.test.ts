import { describe, expect, it } from "vitest"
import {
  getPlaceholderSafe,
  hasInternalMethods,
  hasSubscribe,
  hasToJSON,
  INTERNAL_SYMBOL,
  toJSONSafe,
} from "./type-guards"

describe("type guards", () => {
  describe("hasToJSON", () => {
    it("returns true for objects with toJSON method", () => {
      const obj = { toJSON: () => ({ foo: "bar" }) }
      expect(hasToJSON(obj)).toBe(true)
    })

    it("returns false for objects without toJSON method", () => {
      const obj = { foo: "bar" }
      expect(hasToJSON(obj)).toBe(false)
    })

    it("returns false for primitives", () => {
      expect(hasToJSON(null)).toBe(false)
      expect(hasToJSON(undefined)).toBe(false)
      expect(hasToJSON(42)).toBe(false)
      expect(hasToJSON("string")).toBe(false)
      expect(hasToJSON(true)).toBe(false)
    })

    it("returns false for objects where toJSON is not a function", () => {
      const obj = { toJSON: "not a function" }
      expect(hasToJSON(obj)).toBe(false)
    })
  })

  describe("hasSubscribe", () => {
    it("returns true for objects with subscribe method", () => {
      const obj = { subscribe: () => () => {} }
      expect(hasSubscribe(obj)).toBe(true)
    })

    it("returns false for objects without subscribe method", () => {
      const obj = { foo: "bar" }
      expect(hasSubscribe(obj)).toBe(false)
    })

    it("returns false for primitives", () => {
      expect(hasSubscribe(null)).toBe(false)
      expect(hasSubscribe(undefined)).toBe(false)
    })
  })

  describe("hasInternalMethods", () => {
    it("returns true for objects with INTERNAL_SYMBOL", () => {
      const obj = { [INTERNAL_SYMBOL]: { getPlaceholder: () => "test" } }
      expect(hasInternalMethods(obj)).toBe(true)
    })

    it("returns false for objects without INTERNAL_SYMBOL", () => {
      const obj = { foo: "bar" }
      expect(hasInternalMethods(obj)).toBe(false)
    })

    it("returns false for primitives", () => {
      expect(hasInternalMethods(null)).toBe(false)
      expect(hasInternalMethods(undefined)).toBe(false)
    })
  })

  describe("getPlaceholderSafe", () => {
    it("returns placeholder from object with internal methods", () => {
      const obj = { [INTERNAL_SYMBOL]: { getPlaceholder: () => "placeholder" } }
      expect(getPlaceholderSafe(obj)).toBe("placeholder")
    })

    it("returns undefined for objects without internal methods", () => {
      const obj = { foo: "bar" }
      expect(getPlaceholderSafe(obj)).toBeUndefined()
    })

    it("returns undefined for empty string placeholder", () => {
      const obj = { [INTERNAL_SYMBOL]: { getPlaceholder: () => "" } }
      expect(getPlaceholderSafe(obj)).toBeUndefined()
    })

    it("returns undefined when getPlaceholder is not a function", () => {
      const obj = { [INTERNAL_SYMBOL]: { getPlaceholder: "not a function" } }
      expect(getPlaceholderSafe(obj)).toBeUndefined()
    })

    it("returns undefined for primitives", () => {
      expect(getPlaceholderSafe(null)).toBeUndefined()
      expect(getPlaceholderSafe(undefined)).toBeUndefined()
    })
  })

  describe("toJSONSafe", () => {
    it("calls toJSON on objects with the method", () => {
      const obj = { toJSON: () => ({ result: "value" }) }
      expect(toJSONSafe(obj)).toEqual({ result: "value" })
    })

    it("returns undefined for objects without toJSON", () => {
      const obj = { foo: "bar" }
      expect(toJSONSafe(obj)).toBeUndefined()
    })

    it("returns undefined for primitives", () => {
      expect(toJSONSafe(null)).toBeUndefined()
      expect(toJSONSafe(undefined)).toBeUndefined()
    })
  })
})
