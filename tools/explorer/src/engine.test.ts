import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { DocumentReconstructor } from "./engine.js"
import type { Record } from "./db.js"

describe("DocumentReconstructor", () => {
  it("returns null for negative index", () => {
    const reconstructor = new DocumentReconstructor([])
    expect(reconstructor.getStateAt(-1)).toBeNull()
  })

  it("returns null for index beyond records length", () => {
    const reconstructor = new DocumentReconstructor([])
    expect(reconstructor.getStateAt(0)).toBeNull()
    expect(reconstructor.getStateAt(5)).toBeNull()
  })

  it("reconstructs document state from a single record", () => {
    // Create a LoroDoc and export its update
    const doc = new LoroDoc()
    doc.getText("text").insert(0, "hello")
    doc.commit()
    const update = doc.export({ mode: "update" })

    const records: Record[] = [
      {
        key: "doc1::update::2024-01-01T00:00:00Z",
        docId: "doc1",
        type: "update",
        timestamp: "2024-01-01T00:00:00Z",
        data: update,
      },
    ]

    const reconstructor = new DocumentReconstructor(records)
    const state = reconstructor.getStateAt(0)

    expect(state).toEqual({ text: "hello" })
  })

  it("reconstructs document state from multiple records", () => {
    // Create first update
    const doc1 = new LoroDoc()
    doc1.getText("text").insert(0, "hello")
    doc1.commit()
    const update1 = doc1.export({ mode: "update" })

    // Create second update (building on first)
    const doc2 = new LoroDoc()
    doc2.import(update1)
    doc2.getText("text").insert(5, " world")
    doc2.commit()
    const update2 = doc2.export({ mode: "update", from: doc1.version() })

    const records: Record[] = [
      {
        key: "doc1::update::2024-01-01T00:00:00Z",
        docId: "doc1",
        type: "update",
        timestamp: "2024-01-01T00:00:00Z",
        data: update1,
      },
      {
        key: "doc1::update::2024-01-01T00:00:01Z",
        docId: "doc1",
        type: "update",
        timestamp: "2024-01-01T00:00:01Z",
        data: update2,
      },
    ]

    const reconstructor = new DocumentReconstructor(records)

    // State at index 0 should only have first update
    const state0 = reconstructor.getStateAt(0)
    expect(state0).toEqual({ text: "hello" })

    // State at index 1 should have both updates
    const state1 = reconstructor.getStateAt(1)
    expect(state1).toEqual({ text: "hello world" })
  })
})
