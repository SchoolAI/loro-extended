import { describe, expect, it } from "vitest"
import { unwrap } from "../index.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"
import { INTERNAL_SYMBOL } from "./base.js"

/**
 * Tests to verify internal state encapsulation.
 *
 * After the closure-based refactor, internal state (caches, flags) should be
 * truly hidden from runtime enumeration. Only the INTERNAL_SYMBOL should be
 * visible as a Symbol property.
 */
describe("Internal State Encapsulation", () => {
  describe("Object.keys() returns no internal state", () => {
    it("CounterRef has no enumerable internal state", () => {
      const schema = Shape.doc({
        count: Shape.counter(),
      })
      const doc = createTypedDoc(schema)
      const counterRef = doc.count

      // Object.keys should return empty array (Symbol keys are not enumerable)
      const keys = Object.keys(counterRef)
      expect(keys).toEqual([])

      // Verify the ref still works
      counterRef.increment(5)
      expect(counterRef.value).toBe(5)
    })

    it("TextRef has no enumerable internal state", () => {
      const schema = Shape.doc({
        content: Shape.text(),
      })
      const doc = createTypedDoc(schema)
      const textRef = doc.content

      const keys = Object.keys(textRef)
      expect(keys).toEqual([])

      // Verify the ref still works
      textRef.insert(0, "hello")
      expect(textRef.toString()).toBe("hello")
    })

    it("ListRef has no enumerable internal state", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })
      const doc = createTypedDoc(schema)
      const listRef = doc.items

      const keys = Object.keys(listRef)
      expect(keys).toEqual([])

      // Verify the ref still works
      listRef.push("item1")
      expect(listRef.length).toBe(1)
    })

    it("RecordRef has no enumerable internal state", () => {
      const schema = Shape.doc({
        scores: Shape.record(Shape.plain.number()),
      })
      const doc = createTypedDoc(schema)
      const recordRef = doc.scores

      const keys = Object.keys(recordRef)
      expect(keys).toEqual([])

      // Verify the ref still works
      recordRef.set("alice", 100)
      expect(unwrap(recordRef.get("alice"))).toBe(100)
    })

    it("StructRef has only schema keys (via proxy)", () => {
      const schema = Shape.doc({
        settings: Shape.struct({
          darkMode: Shape.plain.boolean().placeholder(false),
          fontSize: Shape.plain.number().placeholder(14),
        }),
      })
      const doc = createTypedDoc(schema)
      const structRef = doc.settings

      // StructRef uses a proxy that returns only schema keys
      const keys = Object.keys(structRef)
      expect(keys.sort()).toEqual(["darkMode", "fontSize"])

      // Verify the ref still works — outside change(), value shapes return PlainValueRef
      structRef.darkMode = true
      expect(unwrap(structRef.darkMode)).toBe(true)
    })

    it("TreeRef has no enumerable internal state", () => {
      const schema = Shape.doc({
        tree: Shape.tree(
          Shape.struct({
            name: Shape.plain.string().placeholder(""),
          }),
        ),
      })
      const doc = createTypedDoc(schema)
      const treeRef = doc.tree

      const keys = Object.keys(treeRef)
      expect(keys).toEqual([])

      // Verify the ref still works — outside change(), value shapes return PlainValueRef
      const node = treeRef.createNode({ name: "root" })
      expect(unwrap(node.data.name)).toBe("root")
    })
  })

  describe("for...in does not enumerate internal state", () => {
    it("CounterRef for...in returns nothing", () => {
      const schema = Shape.doc({
        count: Shape.counter(),
      })
      const doc = createTypedDoc(schema)
      const counterRef = doc.count

      const enumerated: string[] = []
      for (const key in counterRef) {
        enumerated.push(key)
      }
      expect(enumerated).toEqual([])
    })

    it("ListRef for...in returns nothing", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })
      const doc = createTypedDoc(schema)
      const listRef = doc.items

      const enumerated: string[] = []
      for (const key in listRef) {
        enumerated.push(key)
      }
      expect(enumerated).toEqual([])
    })
  })

  describe("INTERNAL_SYMBOL is accessible but not enumerable", () => {
    it("INTERNAL_SYMBOL is accessible on refs", () => {
      const schema = Shape.doc({
        count: Shape.counter(),
      })
      const doc = createTypedDoc(schema)
      const counterRef = doc.count

      // INTERNAL_SYMBOL should be accessible
      expect(counterRef[INTERNAL_SYMBOL]).toBeDefined()
      expect(typeof counterRef[INTERNAL_SYMBOL].absorbPlainValues).toBe(
        "function",
      )
      expect(typeof counterRef[INTERNAL_SYMBOL].commitIfAuto).toBe("function")
    })

    it("Symbol properties are not in Object.keys()", () => {
      const schema = Shape.doc({
        count: Shape.counter(),
      })
      const doc = createTypedDoc(schema)
      const counterRef = doc.count

      // Object.keys doesn't include Symbol properties
      const keys = Object.keys(counterRef)
      expect(keys).not.toContain(INTERNAL_SYMBOL.toString())
      expect(keys).not.toContain("Symbol(loro-extended:internal)")
    })

    it("Object.getOwnPropertySymbols() returns INTERNAL_SYMBOL", () => {
      const schema = Shape.doc({
        count: Shape.counter(),
      })
      const doc = createTypedDoc(schema)
      const counterRef = doc.count

      // Symbol properties are accessible via getOwnPropertySymbols
      const symbols = Object.getOwnPropertySymbols(counterRef)
      expect(symbols).toContain(INTERNAL_SYMBOL)
    })
  })

  describe("JSON.stringify does not leak internal state", () => {
    it("CounterRef JSON.stringify returns value", () => {
      const schema = Shape.doc({
        count: Shape.counter(),
      })
      const doc = createTypedDoc(schema)
      doc.count.increment(42)

      // toJSON returns the value, not internal state
      expect(JSON.stringify(doc.count)).toBe("42")
    })

    it("ListRef JSON.stringify returns array", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.string()),
      })
      const doc = createTypedDoc(schema)
      doc.items.push("a")
      doc.items.push("b")

      expect(JSON.stringify(doc.items)).toBe('["a","b"]')
    })

    it("StructRef JSON.stringify returns object with schema keys only", () => {
      const schema = Shape.doc({
        settings: Shape.struct({
          darkMode: Shape.plain.boolean().placeholder(false),
          fontSize: Shape.plain.number().placeholder(14),
        }),
      })
      const doc = createTypedDoc(schema)
      doc.settings.darkMode = true

      const json = JSON.parse(JSON.stringify(doc.settings))
      expect(Object.keys(json).sort()).toEqual(["darkMode", "fontSize"])
      expect(json.darkMode).toBe(true)
      expect(json.fontSize).toBe(14)
    })
  })
})
