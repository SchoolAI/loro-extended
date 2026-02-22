import { describe, expect, it } from "vitest"
import { change } from "../functional-helpers.js"
import { loro } from "../loro.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"
import { INTERNAL_SYMBOL } from "../typed-refs/base.js"
import { value } from "../value.js"
import {
  createPlainValueRef,
  getPlainValueRefParentInternals,
  getPlainValueRefPath,
  isPlainValueRef,
  PLAIN_VALUE_REF_SYMBOL,
} from "./index.js"
import {
  getContainerValue,
  getPlaceholderValue,
  resolveListValue,
  resolveValue,
} from "./value-reader.js"
import { writeValue } from "./value-writer.js"

describe("PlainValueRef", () => {
  // Test schema with various plain value types
  const schema = Shape.doc({
    meta: Shape.struct({
      title: Shape.plain.string().placeholder("Untitled"),
      count: Shape.plain.number().placeholder(0),
      active: Shape.plain.boolean().placeholder(false),
      nested: Shape.plain.struct({
        value: Shape.plain.string().placeholder("default"),
        deep: Shape.plain.struct({
          inner: Shape.plain.string().placeholder("innerDefault"),
        }),
      }),
    }),
    scores: Shape.record(Shape.plain.number()),
    tags: Shape.list(Shape.plain.string()),
  })

  describe("isPlainValueRef type guard", () => {
    it("returns true for PlainValueRef objects", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )
      expect(isPlainValueRef(ref)).toBe(true)
    })

    it("returns false for plain values", () => {
      expect(isPlainValueRef("string")).toBe(false)
      expect(isPlainValueRef(123)).toBe(false)
      expect(isPlainValueRef(true)).toBe(false)
      expect(isPlainValueRef(null)).toBe(false)
      expect(isPlainValueRef(undefined)).toBe(false)
      expect(isPlainValueRef({})).toBe(false)
      expect(isPlainValueRef([])).toBe(false)
    })

    it("returns false for TypedRef", () => {
      const doc = createTypedDoc(schema)
      expect(isPlainValueRef(doc.meta)).toBe(false)
    })

    it("returns false for TypedDoc", () => {
      const doc = createTypedDoc(schema)
      expect(isPlainValueRef(doc)).toBe(false)
    })
  })

  describe("createPlainValueRef", () => {
    it("creates a PlainValueRef with correct symbol", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )

      expect(ref[PLAIN_VALUE_REF_SYMBOL]).toBe(true)
    })

    it("stores parent internals", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )

      expect(getPlainValueRefParentInternals(ref)).toBe(internals)
    })

    it("stores path", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      const ref = createPlainValueRef<string>(
        internals,
        ["nested", "value"],
        Shape.plain.string(),
      )

      expect(getPlainValueRefPath(ref)).toEqual(["nested", "value"])
    })
  })

  describe("value reader functions", () => {
    describe("getContainerValue", () => {
      it("reads value from container", () => {
        const doc = createTypedDoc(schema)
        change(doc, draft => {
          draft.meta.title = "Hello"
        })

        const internals = (doc.meta as any)[INTERNAL_SYMBOL]
        expect(getContainerValue(internals, ["title"])).toBe("Hello")
      })

      it("returns undefined for missing path", () => {
        const doc = createTypedDoc(schema)
        const internals = (doc.meta as any)[INTERNAL_SYMBOL]
        expect(getContainerValue(internals, ["nonexistent"])).toBeUndefined()
      })
    })

    describe("getPlaceholderValue", () => {
      it("reads value from placeholder", () => {
        const doc = createTypedDoc(schema)
        const internals = (doc.meta as any)[INTERNAL_SYMBOL]
        expect(getPlaceholderValue(internals, ["title"])).toBe("Untitled")
      })

      it("reads nested placeholder value", () => {
        const doc = createTypedDoc(schema)
        const internals = (doc.meta as any)[INTERNAL_SYMBOL]
        expect(getPlaceholderValue(internals, ["nested", "value"])).toBe(
          "default",
        )
      })
    })

    describe("resolveValue", () => {
      it("returns container value when present", () => {
        const doc = createTypedDoc(schema)
        change(doc, draft => {
          draft.meta.title = "FromContainer"
        })

        const internals = (doc.meta as any)[INTERNAL_SYMBOL]
        expect(resolveValue(internals, ["title"])).toBe("FromContainer")
      })

      it("falls back to placeholder when container value missing", () => {
        const doc = createTypedDoc(schema)
        const internals = (doc.meta as any)[INTERNAL_SYMBOL]
        expect(resolveValue(internals, ["title"])).toBe("Untitled")
      })
    })
  })

  describe("value writer functions", () => {
    describe("writeValue", () => {
      it("writes value at shallow path", () => {
        const doc = createTypedDoc(schema)
        const internals = (doc.meta as any)[INTERNAL_SYMBOL]

        writeValue(internals, ["title"], "Written")

        const container = internals.getContainer()
        expect(container.get("title")).toBe("Written")
      })

      it("writes value at deep path via read-modify-write", () => {
        const doc = createTypedDoc(schema)
        const internals = (doc.meta as any)[INTERNAL_SYMBOL]

        // First set the nested structure
        writeValue(internals, ["nested"], {
          value: "initial",
          deep: { inner: "test" },
        })

        // Then update a nested value
        writeValue(internals, ["nested", "value"], "DeepWritten")

        const container = internals.getContainer()
        const nested = container.get("nested") as any
        expect(nested.value).toBe("DeepWritten")
        expect(nested.deep.inner).toBe("test") // Other values preserved
      })
    })
  })

  describe("PlainValueRef coercion", () => {
    it("valueOf() returns current value", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.title = "Test"
      })

      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )

      expect(ref.valueOf()).toBe("Test")
    })

    it("toString() returns string representation", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.count = 42
      })

      const ref = createPlainValueRef<number>(
        internals,
        ["count"],
        Shape.plain.number(),
      )

      expect(ref.toString()).toBe("42")
    })

    it("toJSON() returns current value", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.title = "JsonTest"
      })

      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )

      expect(ref.toJSON()).toBe("JsonTest")
    })

    it("works in template literals via valueOf()", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.title = "World"
      })

      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )

      // Template literals use Symbol.toPrimitive or valueOf
      expect(`Hello ${ref}`).toBe("Hello World")
    })

    it("works with string concatenation", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.title = "Value"
      })

      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )

      // String concatenation uses valueOf
      expect(`Prefix${ref}`).toBe("PrefixValue")
    })

    it("works with number coercion", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.count = 10
      })

      const ref = createPlainValueRef<number>(
        internals,
        ["count"],
        Shape.plain.number(),
      )

      // Numeric operations use toPrimitive with "number" hint
      expect(+ref).toBe(10)
    })
  })

  describe("value() function", () => {
    it("unwraps PlainValueRef to current value", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.title = "Unwrapped"
      })

      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )

      expect(value(ref)).toBe("Unwrapped")
    })

    it("unwraps TypedRef via toJSON()", () => {
      const doc = createTypedDoc(schema)
      change(doc, draft => {
        draft.meta.title = "Test"
      })

      // Use toJSON() directly since value() overload for StructRef requires TypedDoc
      const metaValue = doc.meta.toJSON()
      expect(metaValue.title).toBe("Test")
    })

    it("unwraps TypedDoc via toJSON()", () => {
      const doc = createTypedDoc(schema)
      change(doc, draft => {
        draft.meta.title = "DocTest"
      })

      const docValue = value(doc)
      expect(docValue.meta.title).toBe("DocTest")
    })

    it("returns placeholder value when container value is undefined", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]

      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )

      expect(value(ref)).toBe("Untitled")
    })
  })

  describe("nested struct value shapes", () => {
    it("creates PlainValueRef for nested struct access", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]

      const nestedShape = Shape.plain.struct({
        value: Shape.plain.string().placeholder("default"),
        deep: Shape.plain.struct({
          inner: Shape.plain.string().placeholder("innerDefault"),
        }),
      })

      const ref = createPlainValueRef<any>(internals, ["nested"], nestedShape)

      // Nested access should return PlainValueRef via Proxy
      // Access through the proxy using bracket notation to avoid TS errors
      const valueRef = (ref as any).value
      expect(isPlainValueRef(valueRef)).toBe(true)
    })

    it("nested PlainValueRef has correct path", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]

      const nestedShape = Shape.plain.struct({
        value: Shape.plain.string().placeholder("default"),
        deep: Shape.plain.struct({
          inner: Shape.plain.string().placeholder("innerDefault"),
        }),
      })

      const ref = createPlainValueRef<any>(internals, ["nested"], nestedShape)
      // Access through the proxy using bracket notation to avoid TS errors
      const valueRef = (ref as any).value

      expect(getPlainValueRefPath(valueRef)).toEqual(["nested", "value"])
    })

    it("deeply nested PlainValueRef works", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]

      const nestedShape = Shape.plain.struct({
        value: Shape.plain.string().placeholder("default"),
        deep: Shape.plain.struct({
          inner: Shape.plain.string().placeholder("innerDefault"),
        }),
      })

      const ref = createPlainValueRef<any>(internals, ["nested"], nestedShape)
      // Access through the proxy using bracket notation to avoid TS errors
      const deepInnerRef = (ref as any).deep.inner

      expect(isPlainValueRef(deepInnerRef)).toBe(true)
      expect(getPlainValueRefPath(deepInnerRef)).toEqual([
        "nested",
        "deep",
        "inner",
      ])
    })

    it("nested struct SET triggers writeValue", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]

      const nestedShape = Shape.plain.struct({
        value: Shape.plain.string().placeholder("default"),
        deep: Shape.plain.struct({
          inner: Shape.plain.string().placeholder("innerDefault"),
        }),
      })

      // Initialize the nested structure
      const container = internals.getContainer()
      container.set("nested", { value: "initial", deep: { inner: "test" } })
      loro(doc).commit()

      const ref = createPlainValueRef<any>(internals, ["nested"], nestedShape)

      // SET should write through via Proxy
      ;(ref as any).value = "updated"

      // Verify the write
      const result = container.get("nested") as any
      expect(result.value).toBe("updated")
    })
  })

  describe("nullable value shapes", () => {
    const nullableSchema = Shape.doc({
      data: Shape.struct({
        nullableTitle: Shape.plain.string().nullable(),
      }),
    })

    it("returns null for null value", () => {
      const doc = createTypedDoc(nullableSchema)
      const internals = (doc.data as any)[INTERNAL_SYMBOL]

      // Set the value to null
      const container = internals.getContainer()
      container.set("nullableTitle", null)
      loro(doc).commit()

      expect(resolveValue(internals, ["nullableTitle"])).toBe(null)
    })

    it("returns string for non-null value", () => {
      const doc = createTypedDoc(nullableSchema)
      const internals = (doc.data as any)[INTERNAL_SYMBOL]

      // Set a string value
      const container = internals.getContainer()
      container.set("nullableTitle", "NotNull")
      loro(doc).commit()

      expect(resolveValue(internals, ["nullableTitle"])).toBe("NotNull")
    })
  })

  describe("PlainValueRef with numbers", () => {
    it("handles number values correctly", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.count = 42
      })

      const ref = createPlainValueRef<number>(
        internals,
        ["count"],
        Shape.plain.number(),
      )

      expect(value(ref)).toBe(42)
      expect(ref.valueOf()).toBe(42)
      expect(+ref).toBe(42)
    })
  })

  describe("PlainValueRef with booleans", () => {
    it("handles boolean values correctly", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.active = true
      })

      const ref = createPlainValueRef<boolean>(
        internals,
        ["active"],
        Shape.plain.boolean(),
      )

      expect(value(ref)).toBe(true)
      expect(ref.valueOf()).toBe(true)
    })

    it("returns placeholder for unset boolean", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]

      const ref = createPlainValueRef<boolean>(
        internals,
        ["active"],
        Shape.plain.boolean(),
      )

      expect(value(ref)).toBe(false)
    })
  })

  describe("PlainValueRef JSON serialization", () => {
    it("works with JSON.stringify", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]
      change(doc, draft => {
        draft.meta.title = "JSONTest"
      })

      const ref = createPlainValueRef<string>(
        internals,
        ["title"],
        Shape.plain.string(),
      )

      // JSON.stringify should call toJSON()
      expect(JSON.stringify(ref)).toBe('"JSONTest"')
    })

    it("nested struct toJSON returns full value", () => {
      const doc = createTypedDoc(schema)
      const internals = (doc.meta as any)[INTERNAL_SYMBOL]

      const container = internals.getContainer()
      container.set("nested", { value: "test", deep: { inner: "nested" } })
      loro(doc).commit()

      const nestedShape = Shape.plain.struct({
        value: Shape.plain.string().placeholder("default"),
        deep: Shape.plain.struct({
          inner: Shape.plain.string().placeholder("innerDefault"),
        }),
      })

      const ref = createPlainValueRef<any>(internals, ["nested"], nestedShape)

      expect(ref.toJSON()).toEqual({ value: "test", deep: { inner: "nested" } })
    })
  })

  describe("resolveListValue null preservation", () => {
    const listSchema = Shape.doc({
      items: Shape.list(Shape.plain.string().nullable()),
    })

    it("returns null for a null item in a list (not undefined)", () => {
      const doc = createTypedDoc(listSchema)

      // Push items including a null via the underlying LoroList
      change(doc, draft => {
        draft.items.push("first")
        draft.items.push(null as any)
        draft.items.push("third")
      })

      const internals = (doc.items as any)[INTERNAL_SYMBOL]

      // resolveListValue must preserve null — not skip it via ??
      expect(resolveListValue(internals, 0)).toBe("first")
      expect(resolveListValue(internals, 1)).toBe(null)
      expect(resolveListValue(internals, 2)).toBe("third")
    })
  })
})
