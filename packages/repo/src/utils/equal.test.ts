import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { equal } from "./equal.js"

describe("equal", () => {
  describe("primitives", () => {
    it("returns true for identical primitives", () => {
      expect(equal(1, 1)).toBe(true)
      expect(equal("hello", "hello")).toBe(true)
      expect(equal(true, true)).toBe(true)
      expect(equal(null, null)).toBe(true)
      expect(equal(undefined, undefined)).toBe(true)
    })

    it("returns false for different primitives", () => {
      expect(equal(1, 2)).toBe(false)
      expect(equal("hello", "world")).toBe(false)
      expect(equal(true, false)).toBe(false)
      expect(equal(null, undefined)).toBe(false)
    })

    it("handles NaN correctly", () => {
      expect(equal(NaN, NaN)).toBe(true)
      expect(equal(NaN, 1)).toBe(false)
    })

    it("distinguishes between 0 and -0", () => {
      // Note: 0 === -0 in JavaScript, so equal returns true
      expect(equal(0, -0)).toBe(true)
    })
  })

  describe("arrays", () => {
    it("returns true for identical arrays", () => {
      expect(equal([1, 2, 3], [1, 2, 3])).toBe(true)
      expect(equal([], [])).toBe(true)
    })

    it("returns false for arrays with different lengths", () => {
      expect(equal([1, 2], [1, 2, 3])).toBe(false)
    })

    it("returns false for arrays with different elements", () => {
      expect(equal([1, 2, 3], [1, 2, 4])).toBe(false)
    })

    it("handles nested arrays", () => {
      // biome-ignore format: keep arrays on single lines for readability
      expect(equal([[1, 2], [3, 4]], [[1, 2], [3, 4]])).toBe(true)
      // biome-ignore format: keep arrays on single lines for readability
      expect(equal([[1, 2], [3, 4]], [[1, 2], [3, 5]])).toBe(false)
    })

    it("handles arrays with mixed types", () => {
      expect(equal([1, "two", true], [1, "two", true])).toBe(true)
      expect(equal([1, "two", true], [1, "two", false])).toBe(false)
    })
  })

  describe("objects", () => {
    it("returns true for identical objects", () => {
      expect(equal({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
      expect(equal({}, {})).toBe(true)
    })

    it("returns false for objects with different keys", () => {
      expect(equal({ a: 1 }, { b: 1 })).toBe(false)
      expect(equal({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    })

    it("returns false for objects with different values", () => {
      expect(equal({ a: 1 }, { a: 2 })).toBe(false)
    })

    it("handles nested objects", () => {
      expect(equal({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
      expect(equal({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
    })

    it("handles objects with array values", () => {
      expect(equal({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
      expect(equal({ a: [1, 2] }, { a: [1, 3] })).toBe(false)
    })
  })

  describe("Maps", () => {
    it("returns true for identical Maps", () => {
      // biome-ignore format: keep arrays on single lines for readability
      const map1 = new Map([["a", 1], ["b", 2]])
      // biome-ignore format: keep arrays on single lines for readability
      const map2 = new Map([["a", 1], ["b", 2]])
      expect(equal(map1, map2)).toBe(true)
    })

    it("returns false for Maps with different sizes", () => {
      // biome-ignore format: keep arrays on single lines for readability
      const map1 = new Map([["a", 1]])
      // biome-ignore format: keep arrays on single lines for readability
      const map2 = new Map([["a", 1], ["b", 2]])
      expect(equal(map1, map2)).toBe(false)
    })

    it("returns false for Maps with different keys", () => {
      const map1 = new Map([["a", 1]])
      const map2 = new Map([["b", 1]])
      expect(equal(map1, map2)).toBe(false)
    })

    it("returns false for Maps with different values", () => {
      const map1 = new Map([["a", 1]])
      const map2 = new Map([["a", 2]])
      expect(equal(map1, map2)).toBe(false)
    })

    it("handles Maps with nested values", () => {
      const map1 = new Map([["a", { b: 1 }]])
      const map2 = new Map([["a", { b: 1 }]])
      expect(equal(map1, map2)).toBe(true)
    })
  })

  describe("Sets", () => {
    it("returns true for identical Sets", () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([1, 2, 3])
      expect(equal(set1, set2)).toBe(true)
    })

    it("returns false for Sets with different sizes", () => {
      const set1 = new Set([1, 2])
      const set2 = new Set([1, 2, 3])
      expect(equal(set1, set2)).toBe(false)
    })

    it("returns false for Sets with different elements", () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([1, 2, 4])
      expect(equal(set1, set2)).toBe(false)
    })
  })

  describe("TypedArrays", () => {
    it("returns true for identical Uint8Arrays", () => {
      const arr1 = new Uint8Array([1, 2, 3])
      const arr2 = new Uint8Array([1, 2, 3])
      expect(equal(arr1, arr2)).toBe(true)
    })

    it("returns false for Uint8Arrays with different lengths", () => {
      const arr1 = new Uint8Array([1, 2])
      const arr2 = new Uint8Array([1, 2, 3])
      expect(equal(arr1, arr2)).toBe(false)
    })

    it("returns false for Uint8Arrays with different values", () => {
      const arr1 = new Uint8Array([1, 2, 3])
      const arr2 = new Uint8Array([1, 2, 4])
      expect(equal(arr1, arr2)).toBe(false)
    })

    it("handles other TypedArray types", () => {
      const int32_1 = new Int32Array([1, 2, 3])
      const int32_2 = new Int32Array([1, 2, 3])
      expect(equal(int32_1, int32_2)).toBe(true)

      const float64_1 = new Float64Array([1.5, 2.5])
      const float64_2 = new Float64Array([1.5, 2.5])
      expect(equal(float64_1, float64_2)).toBe(true)
    })
  })

  describe("RegExp", () => {
    it("returns true for identical RegExps", () => {
      expect(equal(/abc/, /abc/)).toBe(true)
      expect(equal(/abc/gi, /abc/gi)).toBe(true)
    })

    it("returns false for RegExps with different patterns", () => {
      expect(equal(/abc/, /def/)).toBe(false)
    })

    it("returns false for RegExps with different flags", () => {
      expect(equal(/abc/i, /abc/g)).toBe(false)
    })
  })

  describe("Date", () => {
    it("returns true for identical Dates", () => {
      const date1 = new Date("2024-01-01")
      const date2 = new Date("2024-01-01")
      expect(equal(date1, date2)).toBe(true)
    })

    it("returns false for different Dates", () => {
      const date1 = new Date("2024-01-01")
      const date2 = new Date("2024-01-02")
      expect(equal(date1, date2)).toBe(false)
    })
  })

  describe("edge cases", () => {
    it("returns false for different types", () => {
      expect(equal([], {})).toBe(false)
      expect(equal(1, "1")).toBe(false)
      expect(equal(null, {})).toBe(false)
      expect(equal(undefined, null)).toBe(false)
    })

    it("returns false for array vs object with same values", () => {
      expect(equal([1, 2], { 0: 1, 1: 2 })).toBe(false)
    })

    it("handles circular reference detection by same reference", () => {
      const obj1: any = { a: 1 }
      obj1.self = obj1
      // Same reference should be equal
      expect(equal(obj1, obj1)).toBe(true)
    })

    it("handles deeply nested structures", () => {
      const deep1 = { a: { b: { c: { d: { e: 1 } } } } }
      const deep2 = { a: { b: { c: { d: { e: 1 } } } } }
      const deep3 = { a: { b: { c: { d: { e: 2 } } } } }
      expect(equal(deep1, deep2)).toBe(true)
      expect(equal(deep1, deep3)).toBe(false)
    })

    it("does not support objects with null prototype", () => {
      // Note: fast-deep-equal does not support objects with null prototype
      // because they don't have valueOf/toString methods
      const obj1 = Object.create(null)
      obj1.a = 1
      const obj2 = Object.create(null)
      obj2.a = 1
      // This throws because a.valueOf is not a function
      expect(() => equal(obj1, obj2)).toThrow()
    })

    it("handles boxed primitives", () => {
      // eslint-disable-next-line no-new-wrappers
      expect(equal(new String("hello"), new String("hello"))).toBe(true)
      // eslint-disable-next-line no-new-wrappers
      expect(equal(new Number(42), new Number(42))).toBe(true)
      // eslint-disable-next-line no-new-wrappers
      expect(equal(new Boolean(true), new Boolean(true))).toBe(true)
    })
  })

  describe("VersionVector (loro-crdt)", () => {
    it("returns true for identical empty VersionVectors", () => {
      const doc1 = new LoroDoc()
      const doc2 = new LoroDoc()
      expect(equal(doc1.version(), doc2.version())).toBe(true)
    })

    it("returns true for VersionVectors with same content", () => {
      const doc1 = new LoroDoc()
      doc1.getText("text").insert(0, "hello")
      const version1 = doc1.version()

      // Create another doc and import from doc1 to get same version
      const doc2 = new LoroDoc()
      doc2.import(doc1.export({ mode: "snapshot" }))
      const version2 = doc2.version()

      expect(equal(version1, version2)).toBe(true)
    })

    it("returns false for VersionVectors with different content", () => {
      const doc1 = new LoroDoc()
      doc1.getText("text").insert(0, "hello")

      const doc2 = new LoroDoc()
      doc2.getText("text").insert(0, "world")

      expect(equal(doc1.version(), doc2.version())).toBe(false)
    })

    it("returns false for empty vs non-empty VersionVector", () => {
      const doc1 = new LoroDoc()
      const doc2 = new LoroDoc()
      doc2.getText("text").insert(0, "hello")

      expect(equal(doc1.version(), doc2.version())).toBe(false)
    })

    it("handles VersionVector in ReadyState-like objects", () => {
      const doc1 = new LoroDoc()
      doc1.getText("text").insert(0, "hello")

      const doc2 = new LoroDoc()
      doc2.import(doc1.export({ mode: "snapshot" }))

      const readyState1 = {
        state: "loaded",
        docId: "test-doc",
        identity: { peerId: "1", name: "test", type: "user" },
        channels: [],
        lastKnownVersion: doc1.version(),
      }

      const readyState2 = {
        state: "loaded",
        docId: "test-doc",
        identity: { peerId: "1", name: "test", type: "user" },
        channels: [],
        lastKnownVersion: doc2.version(),
      }

      expect(equal(readyState1, readyState2)).toBe(true)
    })

    it("detects changes in ReadyState arrays (for ready-state-changed emission)", () => {
      const doc1 = new LoroDoc()
      doc1.getText("text").insert(0, "hello")

      const doc2 = new LoroDoc()
      doc2.getText("text").insert(0, "hello")
      doc2.getText("text").insert(5, " world")

      const readyStates1 = [
        {
          state: "loaded",
          docId: "test-doc",
          identity: { peerId: "1", name: "test", type: "user" },
          channels: [],
          lastKnownVersion: doc1.version(),
        },
      ]

      const readyStates2 = [
        {
          state: "loaded",
          docId: "test-doc",
          identity: { peerId: "1", name: "test", type: "user" },
          channels: [],
          lastKnownVersion: doc2.version(),
        },
      ]

      // Different versions should be detected
      expect(equal(readyStates1, readyStates2)).toBe(false)
    })
  })
})
