import { LoroDoc, LoroMap } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import { Shape } from "./shape.js"
import { TypedDoc } from "./typed-doc.js"

describe("Schema Garbage Collection", () => {
  it("should cleanup deprecated fields when new version exists", () => {
    const ChatSchema = Shape.doc({
      state: Shape.map({
        messages: Shape.list(Shape.text())
          .key("_v2_messages")
          .migrateFrom({
            key: "_v1_messages",
            sourceShape: Shape.list(Shape.text()),
            transform: v1 => v1,
          }),
      }),
    })

    const doc = new LoroDoc()
    const state = doc.getMap("state")

    // Setup V1 data
    const v1List = state.setContainer("_v1_messages", new LoroList())
    v1List.insert(0, "Hello V1")

    // Setup V2 data (migration happened)
    const v2List = state.setContainer("_v2_messages", new LoroList())
    v2List.insert(0, "Hello V2")

    const typedDoc = new TypedDoc(ChatSchema, doc)

    // Run GC
    const onCleanup = vi.fn()
    typedDoc.gc({ onCleanup })

    // Verify V1 is gone
    expect(state.get("_v1_messages")).toBeUndefined()
    // Verify V2 is still there
    expect(state.get("_v2_messages")).toBeDefined()

    expect(onCleanup).toHaveBeenCalledWith(["_v1_messages"])
  })

  it("should NOT cleanup deprecated fields if new version is missing", () => {
    const ChatSchema = Shape.doc({
      state: Shape.map({
        messages: Shape.list(Shape.text())
          .key("_v2_messages")
          .migrateFrom({
            key: "_v1_messages",
            sourceShape: Shape.list(Shape.text()),
            transform: v1 => v1,
          }),
      }),
    })

    const doc = new LoroDoc()
    const state = doc.getMap("state")

    // Setup V1 data only
    const v1List = state.setContainer("_v1_messages", new LoroList())
    v1List.insert(0, "Hello V1")

    const typedDoc = new TypedDoc(ChatSchema, doc)

    // Run GC
    const onCleanup = vi.fn()
    typedDoc.gc({ onCleanup })

    // Verify V1 is still there
    expect(state.get("_v1_messages")).toBeDefined()
    expect(onCleanup).not.toHaveBeenCalled()
  })

  it("should handle nested migrations", () => {
    const NestedSchema = Shape.doc({
      root: Shape.map({
        nested: Shape.map({
          field: Shape.plain
            .string()
            .key("v2_field")
            .migrateFrom({
              key: "v1_field",
              sourceShape: Shape.plain.string(),
              transform: s => s,
            }),
        }),
      }),
    })

    const doc = new LoroDoc()
    const root = doc.getMap("root")
    const nested = root.setContainer("nested", new LoroMap())

    // Setup V1 and V2
    nested.set("v1_field", "old")
    nested.set("v2_field", "new")

    const typedDoc = new TypedDoc(NestedSchema, doc)

    const onCleanup = vi.fn()
    typedDoc.gc({ onCleanup })

    expect(nested.get("v1_field")).toBeUndefined()
    expect(nested.get("v2_field")).toBe("new")
    expect(onCleanup).toHaveBeenCalledWith(["v1_field"])
  })

  it("should handle multiple migrations (V1 -> V2 -> V3)", () => {
    const MultiVerSchema = Shape.doc({
      state: Shape.map({
        data: Shape.plain
          .string()
          .key("v3_data")
          .migrateFrom({
            key: "v2_data",
            sourceShape: Shape.plain.string(),
            transform: s => s,
          })
          .migrateFrom({
            key: "v1_data",
            sourceShape: Shape.plain.string(),
            transform: s => s,
          }),
      }),
    })

    const doc = new LoroDoc()
    const state = doc.getMap("state")

    // Scenario: V1, V2, and V3 all exist (messy state)
    state.set("v1_data", "v1")
    state.set("v2_data", "v2")
    state.set("v3_data", "v3")

    const typedDoc = new TypedDoc(MultiVerSchema, doc)

    const onCleanup = vi.fn()
    typedDoc.gc({ onCleanup })

    // Should clean up both V1 and V2 because V3 exists
    expect(state.get("v1_data")).toBeUndefined()
    expect(state.get("v2_data")).toBeUndefined()
    expect(state.get("v3_data")).toBe("v3")

    // Order of cleanup depends on implementation, but both should be in the list
    expect(onCleanup).toHaveBeenCalled()
    const deleted = onCleanup.mock.calls[0][0]
    expect(deleted).toContain("v1_data")
    expect(deleted).toContain("v2_data")
  })
})

// Helper to import LoroList for test setup
import { LoroList } from "loro-crdt"
