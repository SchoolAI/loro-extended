import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { ext } from "./ext.js"
import { change } from "./functional-helpers.js"
import { hasMetadata, META_CONTAINER_NAME, readMetadata } from "./metadata.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

describe("Shape.doc with options", () => {
  it("accepts mergeable option", () => {
    const schema = Shape.doc(
      {
        players: Shape.record(
          Shape.struct({ score: Shape.plain.number().placeholder(0) }),
        ),
      },
      { mergeable: true },
    )

    expect(schema.mergeable).toBe(true)
  })

  it("defaults mergeable to undefined when not specified", () => {
    const schema = Shape.doc({
      title: Shape.text(),
    })

    expect(schema.mergeable).toBeUndefined()
  })

  it("schema.mergeable is accessible", () => {
    const schemaTrue = Shape.doc({ title: Shape.text() }, { mergeable: true })
    const schemaFalse = Shape.doc({ title: Shape.text() }, { mergeable: false })
    const schemaDefault = Shape.doc({ title: Shape.text() })

    expect(schemaTrue.mergeable).toBe(true)
    expect(schemaFalse.mergeable).toBe(false)
    expect(schemaDefault.mergeable).toBeUndefined()
  })
})

describe("TypedDoc Metadata Integration", () => {
  it("writes metadata on first access for mergeable docs", () => {
    const schema = Shape.doc(
      {
        players: Shape.record(
          Shape.struct({ score: Shape.plain.number().placeholder(0) }),
        ),
      },
      { mergeable: true },
    )

    const loroDoc = new LoroDoc()
    expect(hasMetadata(loroDoc)).toBe(false)

    // Creating TypedDoc should write metadata
    createTypedDoc(schema, { doc: loroDoc })

    expect(hasMetadata(loroDoc)).toBe(true)
    const meta = readMetadata(loroDoc)
    expect(meta.mergeable).toBe(true)
  })

  it("writes metadata for all docs by default", () => {
    const schema = Shape.doc({
      title: Shape.text(),
    })

    const loroDoc = new LoroDoc()
    createTypedDoc(schema, { doc: loroDoc })

    // All docs now write metadata by default
    expect(hasMetadata(loroDoc)).toBe(true)
    const meta = readMetadata(loroDoc)
    expect(meta.mergeable).toBe(false)
  })

  it("skips metadata write when skipInitialize is true", () => {
    const schema = Shape.doc({
      title: Shape.text(),
    })

    const loroDoc = new LoroDoc()
    createTypedDoc(schema, { doc: loroDoc, skipInitialize: true })

    // No metadata written
    expect(hasMetadata(loroDoc)).toBe(false)
    expect(loroDoc.opCount()).toBe(0)
  })

  it("allows manual initialization after skipInitialize", () => {
    const schema = Shape.doc({
      title: Shape.text(),
    })

    const loroDoc = new LoroDoc()
    const doc = createTypedDoc(schema, { doc: loroDoc, skipInitialize: true })

    // No metadata yet
    expect(hasMetadata(loroDoc)).toBe(false)

    // Manually initialize
    ext(doc).initialize()

    // Now has metadata
    expect(hasMetadata(loroDoc)).toBe(true)
    const meta = readMetadata(loroDoc)
    expect(meta.mergeable).toBe(false)
  })

  it("initialize() is idempotent", () => {
    const schema = Shape.doc({
      title: Shape.text(),
    })

    const loroDoc = new LoroDoc()
    const doc = createTypedDoc(schema, { doc: loroDoc, skipInitialize: true })

    ext(doc).initialize()
    const opCountAfterFirst = loroDoc.opCount()

    ext(doc).initialize() // Second call should be no-op
    expect(loroDoc.opCount()).toBe(opCountAfterFirst)
  })

  it("reads metadata on subsequent access", () => {
    const schema = Shape.doc(
      {
        players: Shape.record(
          Shape.struct({ score: Shape.plain.number().placeholder(0) }),
        ),
      },
      { mergeable: true },
    )

    // First peer creates doc
    const loroDoc1 = new LoroDoc()
    const doc1 = createTypedDoc(schema, { doc: loroDoc1 })

    // Make some changes
    change(doc1, draft => {
      draft.players.set("alice", { score: 100 })
    })

    // Export and import to simulate sync
    const bytes = loroDoc1.export({ mode: "snapshot" })
    const loroDoc2 = new LoroDoc()
    loroDoc2.import(bytes)

    // Second peer reads metadata
    expect(hasMetadata(loroDoc2)).toBe(true)
    const meta = readMetadata(loroDoc2)
    expect(meta.mergeable).toBe(true)
  })

  it("uses metadata value over schema when they differ", () => {
    // Create a doc with mergeable: true
    const schema1 = Shape.doc(
      {
        players: Shape.record(
          Shape.struct({ score: Shape.plain.number().placeholder(0) }),
        ),
      },
      { mergeable: true },
    )

    const loroDoc = new LoroDoc()
    createTypedDoc(schema1, { doc: loroDoc })

    // Now try to use it with a schema that says mergeable: false
    const schema2 = Shape.doc(
      {
        players: Shape.record(
          Shape.struct({ score: Shape.plain.number().placeholder(0) }),
        ),
      },
      { mergeable: false },
    )

    // This should use the metadata value (true), not the schema value (false)
    // Metadata takes precedence over schema
    createTypedDoc(schema2, { doc: loroDoc })

    // The effective mergeable should be from metadata (true)
    const meta = readMetadata(loroDoc)
    expect(meta.mergeable).toBe(true)
  })

  it("toJSON excludes _loro_extended* prefixed keys", () => {
    const schema = Shape.doc(
      {
        players: Shape.record(
          Shape.struct({ score: Shape.plain.number().placeholder(0) }),
        ),
      },
      { mergeable: true },
    )

    const doc = createTypedDoc(schema)
    change(doc, draft => {
      draft.players.set("alice", { score: 100 })
    })

    const json = doc.toJSON()

    // Should have players
    expect(json.players).toBeDefined()
    expect(json.players.alice).toEqual({ score: 100 })

    // Should NOT have metadata container
    expect(
      (json as Record<string, unknown>)[META_CONTAINER_NAME],
    ).toBeUndefined()

    // Check that no keys start with the reserved prefix
    for (const key of Object.keys(json)) {
      expect(key.startsWith("_loro_extended")).toBe(false)
    }
  })

  it("toJSON excludes reserved keys for non-mergeable docs too", () => {
    const schema = Shape.doc({
      title: Shape.text(),
    })

    const loroDoc = new LoroDoc()
    // Manually add a reserved key
    const metaMap = loroDoc.getMap(META_CONTAINER_NAME)
    metaMap.set("test", "value")
    loroDoc.commit()

    const doc = createTypedDoc(schema, { doc: loroDoc })
    doc.title.update("Hello")

    const json = doc.toJSON()

    // Should have title
    expect(json.title).toBe("Hello")

    // Should NOT have metadata container
    expect(
      (json as Record<string, unknown>)[META_CONTAINER_NAME],
    ).toBeUndefined()
  })

  it("backward compatible with docs without metadata", () => {
    // Create a doc without metadata (simulating legacy doc)
    const loroDoc = new LoroDoc()
    // LoroText doesn't have update, so we use the raw container
    const text = loroDoc.getText("title")
    text.insert(0, "Hello")
    loroDoc.commit()

    // Use it with a non-mergeable schema
    const schema = Shape.doc({
      title: Shape.text(),
    })

    const doc = createTypedDoc(schema, { doc: loroDoc })

    // Should work and write metadata
    expect(doc.toJSON().title).toBe("Hello")
    expect(hasMetadata(loroDoc)).toBe(true)
  })

  it("options.mergeable overrides schema.mergeable", () => {
    const schema = Shape.doc(
      {
        players: Shape.record(
          Shape.struct({ score: Shape.plain.number().placeholder(0) }),
        ),
      },
      { mergeable: false },
    )

    const loroDoc = new LoroDoc()
    // Override with options
    createTypedDoc(schema, { doc: loroDoc, mergeable: true })

    // Metadata should reflect the options value
    expect(hasMetadata(loroDoc)).toBe(true)
    const meta = readMetadata(loroDoc)
    expect(meta.mergeable).toBe(true)
  })
})
