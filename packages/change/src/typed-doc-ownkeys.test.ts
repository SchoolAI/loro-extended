import { describe, expect, it } from "vitest"
import { createTypedDoc, Shape } from "./index.js"

/**
 * Tests for TypedDoc proxy ownKeys behavior.
 *
 * Issue: The TypedDoc proxy's ownKeys trap delegates to Reflect.ownKeys(target),
 * which returns Symbol properties (INTERNAL_SYMBOL, LORO_SYMBOL) from the DocRef target.
 *
 * This causes React to throw:
 * "Object keys must be strings; symbol properties are not supported"
 *
 * Fix: Filter out Symbol properties in the ownKeys trap.
 * Location: packages/change/src/typed-doc.ts lines 325-327
 */
describe("TypedDoc proxy ownKeys", () => {
  const schema = Shape.doc({
    title: Shape.text(),
    count: Shape.counter(),
    settings: Shape.struct({
      darkMode: Shape.plain.boolean().placeholder(false),
      fontSize: Shape.plain.number().placeholder(14),
    }),
  })

  describe("Reflect.ownKeys()", () => {
    it("should return only string keys, no Symbols", () => {
      const doc = createTypedDoc(schema)

      const keys = Reflect.ownKeys(doc)

      // All keys should be strings (no Symbols)
      // This test will FAIL until the fix is applied
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })
  })

  describe("Object.keys()", () => {
    it("should return only string keys", () => {
      const doc = createTypedDoc(schema)

      const keys = Object.keys(doc)

      // All keys should be strings
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }

      // Should include schema keys
      expect(keys).toContain("title")
      expect(keys).toContain("count")
      expect(keys).toContain("settings")
    })
  })

  describe("for...in loop", () => {
    it("should iterate only string keys", () => {
      const doc = createTypedDoc(schema)

      const keys: (string | symbol)[] = []
      for (const key in doc) {
        keys.push(key)
      }

      // All keys should be strings
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })
  })

  describe("Object.entries()", () => {
    it("should work without errors", () => {
      const doc = createTypedDoc(schema)

      // This should not throw "Object keys must be strings"
      const entries = Object.entries(doc)

      // All keys should be strings
      for (const [key] of entries) {
        expect(typeof key).toBe("string")
      }
    })
  })

  describe("spread operator", () => {
    it("should work without errors", () => {
      const doc = createTypedDoc(schema)
      doc.title.insert(0, "Hello")

      // This should not throw
      const spread = { ...doc }

      // Should have the schema keys
      expect("title" in spread).toBe(true)
      expect("count" in spread).toBe(true)
      expect("settings" in spread).toBe(true)
    })
  })

  describe("JSON.stringify()", () => {
    it("should work without errors", () => {
      const doc = createTypedDoc(schema)
      doc.title.insert(0, "Hello")
      doc.count.increment(5)

      // This should not throw
      const json = JSON.stringify(doc)

      expect(json).toBeDefined()
      expect(typeof json).toBe("string")
    })
  })
})
