/**
 * Type tests to verify RecordRef bracket access is properly typed
 * after removing `| any` from the index signature.
 *
 * These tests use expectTypeOf to verify types at compile time.
 */

import { describe, expectTypeOf, it } from "vitest"
import { change } from "../functional-helpers.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

describe("RecordRef type inference", () => {
  const PreferenceSchema = Shape.struct({
    showTip: Shape.plain.boolean(),
  })

  const ChatSchema = Shape.doc({
    preferences: Shape.record(PreferenceSchema),
  })

  describe("bracket access types", () => {
    it("should not return 'any' for bracket access", () => {
      const doc = createTypedDoc(ChatSchema)
      const myPeerId = "peer-123"

      // The key test: bracket access should NOT be 'any'
      const prefs = doc.preferences[myPeerId]

      // If this was 'any', the following would not cause a type error
      // but with proper typing, it should be a union type
      expectTypeOf(prefs).not.toBeAny()
    })

    it("should allow optional chaining on bracket access", () => {
      const doc = createTypedDoc(ChatSchema)
      const myPeerId = "peer-123"

      // Optional chaining should work since result includes undefined
      const showTipRef = doc.preferences[myPeerId]?.showTip

      // showTip is a PlainValueRef<boolean> | undefined
      expectTypeOf(showTipRef).not.toBeAny()
    })

    it("should have .get() return compatible type", () => {
      const doc = createTypedDoc(ChatSchema)
      const myPeerId = "peer-123"

      const viaGet = doc.preferences.get(myPeerId)
      const _viaBracket = doc.preferences[myPeerId]

      // Both should include StructRef in their types
      // .get() returns StructRef | undefined
      expectTypeOf(viaGet).not.toBeAny()
      expectTypeOf(_viaBracket).not.toBeAny()
    })

    it("should allow plain value assignment via bracket notation", () => {
      const doc = createTypedDoc(ChatSchema)
      const myPeerId = "peer-123"

      // Inside change(), bracket assignment should accept plain values
      change(doc, d => {
        // This should type-check without error
        d.preferences[myPeerId] = { showTip: true }
      })
    })

    it("should allow plain value via .set() method", () => {
      const doc = createTypedDoc(ChatSchema)
      const myPeerId = "peer-123"

      change(doc, d => {
        // .set() should also accept plain values
        d.preferences.set(myPeerId, { showTip: false })
      })
    })
  })

  describe("toJSON return type", () => {
    it("should return plain Record type from toJSON()", () => {
      const doc = createTypedDoc(ChatSchema)

      const snapshot = doc.preferences.toJSON()

      // Should be Record<string, { showTip: boolean }>
      expectTypeOf(snapshot).toMatchTypeOf<
        Record<string, { showTip: boolean }>
      >()
    })

    it("should have plain object values in toJSON result", () => {
      const doc = createTypedDoc(ChatSchema)
      const myPeerId = "peer-123"

      const snapshot = doc.preferences.toJSON()
      const prefs = snapshot[myPeerId]

      // The snapshot value should be a plain object, not a ref
      if (prefs) {
        expectTypeOf(prefs).toMatchTypeOf<{ showTip: boolean }>()
      }
    })
  })

  describe("method types are preserved", () => {
    it("should have properly typed methods", () => {
      const doc = createTypedDoc(ChatSchema)

      // Methods should still be accessible and properly typed
      expectTypeOf(doc.preferences.set).toBeFunction()
      expectTypeOf(doc.preferences.get).toBeFunction()
      expectTypeOf(doc.preferences.delete).toBeFunction()
      expectTypeOf(doc.preferences.has).toBeFunction()
      expectTypeOf(doc.preferences.keys).toBeFunction()
      expectTypeOf(doc.preferences.values).toBeFunction()
      expectTypeOf(doc.preferences.entries).toBeFunction()
      expectTypeOf(doc.preferences.size).toBeNumber()
      expectTypeOf(doc.preferences.toJSON).toBeFunction()
    })
  })
})
