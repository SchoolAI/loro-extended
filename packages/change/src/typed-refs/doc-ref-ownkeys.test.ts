import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { derivePlaceholder } from "../derive-placeholder.js"
import { Shape } from "../index.js"
import { DocRef } from "./doc-ref.js"

/**
 * Tests for DocRef class ownKeys behavior.
 *
 * Issue: DocRef extends TypedRef which has Symbol properties:
 * - [INTERNAL_SYMBOL]: DocRefInternals<Shape>
 * - [LORO_SYMBOL]: getter for loro() access
 *
 * When Reflect.ownKeys() is called on a DocRef instance, it returns these
 * Symbol properties along with the schema keys.
 *
 * This is the underlying cause of the TypedDoc proxy issue - the proxy
 * delegates ownKeys to the DocRef target.
 *
 * Note: DocRef is not a proxy, it's a class. The fix for this is in the
 * TypedDoc proxy's ownKeys trap, which should filter out Symbols.
 */
describe("DocRef ownKeys", () => {
  const schema = Shape.doc({
    title: Shape.text(),
    count: Shape.counter(),
  })

  function createDocRef() {
    const loroDoc = new LoroDoc()
    const placeholder = derivePlaceholder(schema)
    return new DocRef({
      shape: schema,
      placeholder,
      doc: loroDoc,
      autoCommit: true,
    })
  }

  describe("Reflect.ownKeys() on DocRef instance", () => {
    it("returns Symbol properties from the class", () => {
      const docRef = createDocRef()

      const keys = Reflect.ownKeys(docRef)

      // DocRef has Symbol properties from TypedRef base class
      // This test documents the current behavior
      const symbolKeys = keys.filter(k => typeof k === "symbol")
      const stringKeys = keys.filter(k => typeof k === "string")

      // Should have schema keys as strings
      expect(stringKeys).toContain("title")
      expect(stringKeys).toContain("count")

      // Currently has Symbol keys (this is the root cause of the issue)
      // The TypedDoc proxy should filter these out
      expect(symbolKeys.length).toBeGreaterThan(0)
    })
  })

  describe("Object.keys() on DocRef instance", () => {
    it("should return only enumerable string keys", () => {
      const docRef = createDocRef()

      const keys = Object.keys(docRef)

      // Object.keys only returns enumerable string keys
      // Symbol properties are not enumerable by default
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }

      // Should include schema keys
      expect(keys).toContain("title")
      expect(keys).toContain("count")
    })
  })
})
