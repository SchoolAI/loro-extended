import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import {
  hasMetadata,
  isLoroExtendedReservedKey,
  LORO_EXTENDED_PREFIX,
  META_CONTAINER_NAME,
  readMetadata,
  writeMetadata,
} from "./metadata.js"

describe("Metadata Constants", () => {
  it("has correct prefix", () => {
    expect(LORO_EXTENDED_PREFIX).toBe("_loro_extended")
  })

  it("has correct meta container name", () => {
    expect(META_CONTAINER_NAME).toBe("_loro_extended_meta_")
  })

  it("meta container name starts with prefix", () => {
    expect(META_CONTAINER_NAME.startsWith(LORO_EXTENDED_PREFIX)).toBe(true)
  })
})

describe("isLoroExtendedReservedKey", () => {
  it("returns true for meta container name", () => {
    expect(isLoroExtendedReservedKey(META_CONTAINER_NAME)).toBe(true)
  })

  it("returns true for keys starting with prefix", () => {
    expect(isLoroExtendedReservedKey("_loro_extended_foo")).toBe(true)
    expect(isLoroExtendedReservedKey("_loro_extended")).toBe(true)
    expect(isLoroExtendedReservedKey("_loro_extended_")).toBe(true)
  })

  it("returns false for regular keys", () => {
    expect(isLoroExtendedReservedKey("players")).toBe(false)
    expect(isLoroExtendedReservedKey("_private")).toBe(false)
    expect(isLoroExtendedReservedKey("loro_extended")).toBe(false)
    expect(isLoroExtendedReservedKey("")).toBe(false)
  })
})

describe("Metadata Utilities", () => {
  it("hasMetadata returns false for new doc", () => {
    const doc = new LoroDoc()
    expect(hasMetadata(doc)).toBe(false)
  })

  it("hasMetadata returns true after writeMetadata", () => {
    const doc = new LoroDoc()
    writeMetadata(doc, { mergeable: true })
    expect(hasMetadata(doc)).toBe(true)
  })

  it("returns empty object for doc without metadata", () => {
    const doc = new LoroDoc()
    const meta = readMetadata(doc)
    expect(meta).toEqual({})
  })

  it("writes and reads mergeable correctly", () => {
    const doc = new LoroDoc()
    writeMetadata(doc, { mergeable: true })

    const meta = readMetadata(doc)
    expect(meta.mergeable).toBe(true)
  })

  it("writes and reads mergeable: false correctly", () => {
    const doc = new LoroDoc()
    writeMetadata(doc, { mergeable: false })

    const meta = readMetadata(doc)
    expect(meta.mergeable).toBe(false)
  })

  it("writes and reads schemaVersion correctly", () => {
    const doc = new LoroDoc()
    writeMetadata(doc, { schemaVersion: "1.0.0" })

    const meta = readMetadata(doc)
    expect(meta.schemaVersion).toBe("1.0.0")
  })

  it("writes and reads multiple fields correctly", () => {
    const doc = new LoroDoc()
    writeMetadata(doc, { mergeable: true, schemaVersion: "2.0.0" })

    const meta = readMetadata(doc)
    expect(meta.mergeable).toBe(true)
    expect(meta.schemaVersion).toBe("2.0.0")
  })

  it("metadata survives export/import", () => {
    const doc1 = new LoroDoc()
    writeMetadata(doc1, { mergeable: true, schemaVersion: "1.0.0" })

    // Export and import
    const bytes = doc1.export({ mode: "snapshot" })
    const doc2 = new LoroDoc()
    doc2.import(bytes)

    expect(hasMetadata(doc2)).toBe(true)
    const meta = readMetadata(doc2)
    expect(meta.mergeable).toBe(true)
    expect(meta.schemaVersion).toBe("1.0.0")
  })
})
