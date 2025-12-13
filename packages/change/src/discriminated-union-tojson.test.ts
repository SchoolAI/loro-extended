import { LoroDoc, LoroMap } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { change } from "./functional-helpers.js"
import { Shape } from "./shape.js"
import { createTypedDoc, TypedDoc } from "./typed-doc.js"

/**
 * This test file reproduces the "placeholder required" error reported by users
 * when calling toJSON() on a document with Records containing Maps.
 *
 * The bug: When a Record contains Map entries that exist in the CRDT but not
 * in the placeholder (which is always {} for Records), the nested MapRef is
 * created with placeholder: undefined. When MapRef.toJSON() tries to access
 * value properties that don't exist in the CRDT, it throws "placeholder required".
 */
describe("Record with Map entries - placeholder required bug", () => {
  // Reproduce the user's schema structure
  const StudentTomStateSchema = Shape.map({
    peerId: Shape.plain.string(),
    authorName: Shape.plain.string(),
    authorColor: Shape.plain.string(),
    intentionHistory: Shape.list(
      Shape.map({
        observedAt: Shape.plain.number(),
        messageTimestamp: Shape.plain.number(),
        predictions: Shape.list(
          Shape.map({
            horizon: Shape.plain.string("now", "soon", "future"),
            value: Shape.plain.string(),
          }),
        ),
      }),
    ),
    emotionHistory: Shape.list(
      Shape.map({
        observedAt: Shape.plain.number(),
        messageTimestamp: Shape.plain.number(),
        predictions: Shape.list(
          Shape.map({
            horizon: Shape.plain.string("now", "soon", "future"),
            value: Shape.plain.string(),
          }),
        ),
      }),
    ),
  })

  const AiStateSchema = Shape.doc({
    tomState: Shape.record(StudentTomStateSchema),
  })

  it("should call toJSON() without error when Record has entries in CRDT", () => {
    // Simulate loading an existing document that has Record entries
    const loroDoc = new LoroDoc()

    // Add an entry to the tomState record
    const tomStateMap = loroDoc.getMap("tomState")
    const studentMap = tomStateMap.setContainer("peer-123", new LoroMap())

    // Set some but not all properties on the student map
    // This simulates partial data from sync
    studentMap.set("peerId", "peer-123")
    studentMap.set("authorName", "Alice")
    // Note: authorColor is NOT set - this should fall back to placeholder

    // Now wrap it with TypedDoc
    const typedDoc = new TypedDoc(AiStateSchema, loroDoc)

    // This should not throw "placeholder required"
    // BUG: Currently throws because the nested MapRef has placeholder: undefined
    expect(() => {
      typedDoc.toJSON()
    }).not.toThrow()
  })

  it("should call toJSON() without error on fresh document with Record entries added via change()", () => {
    const typedDoc = createTypedDoc(AiStateSchema)

    // Add an entry via the typed API
    change(typedDoc, draft => {
      draft.tomState.set("peer-123", {
        peerId: "peer-123",
        authorName: "Alice",
        authorColor: "#ff0000",
        intentionHistory: [],
        emotionHistory: [],
      })
    })

    // This should work because all values were set
    expect(() => {
      typedDoc.toJSON()
    }).not.toThrow()
  })

  it("should handle Record with partial Map data from CRDT sync", () => {
    // This is the key scenario: CRDT sync brings in partial data
    const loroDoc = new LoroDoc()

    // Simulate what happens when CRDT sync brings in a record entry
    // with only some fields populated
    const tomStateMap = loroDoc.getMap("tomState")

    // Create a nested map for the student
    const studentMap = tomStateMap.setContainer("peer-456", new LoroMap())

    // Only set peerId - other fields are missing
    studentMap.set("peerId", "peer-456")

    const typedDoc = new TypedDoc(AiStateSchema, loroDoc)

    // This should not throw - missing fields should use placeholder defaults
    expect(() => {
      typedDoc.toJSON()
    }).not.toThrow()
  })
})
