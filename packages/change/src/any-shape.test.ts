import { describe, expect, it } from "vitest"
import { deriveShapePlaceholder } from "./derive-placeholder.js"
import { mergeValue } from "./overlay.js"
import { Shape } from "./shape.js"
import type { Infer } from "./types.js"

describe("Shape.any()", () => {
  it("creates an AnyContainerShape", () => {
    const shape = Shape.any()
    expect(shape._type).toBe("any")
    expect(shape._placeholder).toBeUndefined()
  })

  it("can be used in a doc shape", () => {
    const docShape = Shape.doc({
      content: Shape.any(),
    })
    expect(docShape.shapes.content._type).toBe("any")
  })

  it("derives undefined placeholder for any container", () => {
    const shape = Shape.any()
    const placeholder = deriveShapePlaceholder(shape)
    expect(placeholder).toBeUndefined()
  })

  it("mergeValue returns CRDT value as-is for any container", () => {
    const shape = Shape.any()
    const crdtValue = { nested: { data: "test" } }
    const result = mergeValue(shape, crdtValue, undefined)
    expect(result).toBe(crdtValue)
  })

  it("type inference produces unknown for any container", () => {
    const docShape = Shape.doc({
      content: Shape.any(),
    })
    // Type test: Infer<typeof docShape> should have content: unknown
    type DocType = Infer<typeof docShape>
    const _typeCheck: DocType = { content: "anything" }
    const _typeCheck2: DocType = { content: { nested: true } }
    const _typeCheck3: DocType = { content: 123 }
    expect(true).toBe(true) // Type-level test
  })
})

describe("Shape.plain.any()", () => {
  it("creates an AnyValueShape", () => {
    const shape = Shape.plain.any()
    expect(shape._type).toBe("value")
    expect(shape.valueType).toBe("any")
    expect(shape._placeholder).toBeUndefined()
  })

  it("can be used in a struct value shape", () => {
    const presenceShape = Shape.plain.struct({
      metadata: Shape.plain.any(),
    })
    expect(presenceShape.shape.metadata.valueType).toBe("any")
  })

  it("derives undefined placeholder for any value", () => {
    const shape = Shape.plain.any()
    const placeholder = deriveShapePlaceholder(shape)
    expect(placeholder).toBeUndefined()
  })

  it("mergeValue returns CRDT value as-is for any value", () => {
    const shape = Shape.plain.any()
    const crdtValue = { anything: "goes" }
    const result = mergeValue(shape, crdtValue, undefined)
    expect(result).toBe(crdtValue)
  })
})

describe("Shape.plain.bytes()", () => {
  it("creates a Uint8ArrayValueShape", () => {
    const shape = Shape.plain.bytes()
    expect(shape._type).toBe("value")
    expect(shape.valueType).toBe("uint8array")
  })

  it("is equivalent to Shape.plain.uint8Array()", () => {
    const bytesShape = Shape.plain.bytes()
    const uint8ArrayShape = Shape.plain.uint8Array()
    expect(bytesShape._type).toBe(uint8ArrayShape._type)
    expect(bytesShape.valueType).toBe(uint8ArrayShape.valueType)
  })

  it("supports .nullable()", () => {
    const shape = Shape.plain.bytes().nullable()
    expect(shape.valueType).toBe("union")
    expect(shape.shapes[0].valueType).toBe("null")
    expect(shape.shapes[1].valueType).toBe("uint8array")
  })

  it("can be used for cursor presence data", () => {
    const CursorPresenceShape = Shape.plain.struct({
      anchor: Shape.plain.bytes().nullable(),
      focus: Shape.plain.bytes().nullable(),
      user: Shape.plain
        .struct({
          name: Shape.plain.string(),
          color: Shape.plain.string(),
        })
        .nullable(),
    })

    // Type test: should compile
    type CursorPresence = Infer<typeof CursorPresenceShape>
    const _typeCheck: CursorPresence = {
      anchor: new Uint8Array([1, 2, 3]),
      focus: null,
      user: { name: "Alice", color: "#ff0000" },
    }
    expect(CursorPresenceShape.shape.anchor.valueType).toBe("union")
  })
})

describe("Shape.plain.uint8Array().nullable()", () => {
  it("supports .nullable()", () => {
    const shape = Shape.plain.uint8Array().nullable()
    expect(shape.valueType).toBe("union")
    expect(shape.shapes[0].valueType).toBe("null")
    expect(shape.shapes[1].valueType).toBe("uint8array")
  })
})

describe("Integration: loro-prosemirror style usage", () => {
  it("allows typed presence with untyped document", () => {
    // This is the target API for loro-prosemirror integration
    const ProseMirrorDocShape = Shape.doc({
      doc: Shape.any(), // loro-prosemirror manages this
    })

    const CursorPresenceShape = Shape.plain.struct({
      anchor: Shape.plain.bytes().nullable(),
      focus: Shape.plain.bytes().nullable(),
      user: Shape.plain
        .struct({
          name: Shape.plain.string(),
          color: Shape.plain.string(),
        })
        .nullable(),
    })

    // Type tests
    type DocType = Infer<typeof ProseMirrorDocShape>
    type PresenceType = Infer<typeof CursorPresenceShape>

    // Document content is unknown (we opted out)
    const _docTypeCheck: DocType = { doc: "anything" }

    // Presence is fully typed
    const _presenceTypeCheck: PresenceType = {
      anchor: new Uint8Array([1, 2, 3]),
      focus: null,
      user: { name: "Alice", color: "#ff0000" },
    }

    expect(ProseMirrorDocShape.shapes.doc._type).toBe("any")
    expect(CursorPresenceShape.shape.anchor.valueType).toBe("union")
  })
})
