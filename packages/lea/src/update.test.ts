import { change, createTypedDoc, loro, Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { createUpdate, getTimestampFromFrontier } from "./update.js"

// ═══════════════════════════════════════════════════════════════════════════
// Test Schema
// ═══════════════════════════════════════════════════════════════════════════

const TestSchema = Shape.doc({
  state: Shape.struct({
    status: Shape.plain.string(),
    count: Shape.plain.number(),
  }),
})

type TestMsg =
  | { type: "START" }
  | { type: "INCREMENT" }
  | { type: "SET_COUNT"; value: number }

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("createUpdate", () => {
  it("creates an update function that modifies the document", () => {
    const doc = createTypedDoc(TestSchema)
    const frontier = loro(doc).doc.frontiers()

    const update = createUpdate<typeof TestSchema, TestMsg>(
      (workingDoc, msg) => {
        if (msg.type === "START") {
          change(workingDoc, draft => {
            draft.state.status = "running"
          })
        }
      },
    )

    const newFrontier = update(doc, frontier, { type: "START" })

    // Verify the document was updated
    expect(doc.state.status).toBe("running")

    // Verify frontier advanced
    expect(newFrontier).not.toEqual(frontier)
  })

  it("preserves peer ID across updates (frontier advances correctly)", () => {
    const doc = createTypedDoc(TestSchema)
    let frontier = loro(doc).doc.frontiers()

    const update = createUpdate<typeof TestSchema, TestMsg>(
      (workingDoc, msg) => {
        if (msg.type === "INCREMENT") {
          change(workingDoc, draft => {
            draft.state.count = (workingDoc.state.count ?? 0) + 1
          })
        }
      },
    )

    // First update
    frontier = update(doc, frontier, { type: "INCREMENT" })
    const t1 = getTimestampFromFrontier(frontier)

    // Second update
    frontier = update(doc, frontier, { type: "INCREMENT" })
    const t2 = getTimestampFromFrontier(frontier)

    // Third update
    frontier = update(doc, frontier, { type: "INCREMENT" })
    const t3 = getTimestampFromFrontier(frontier)

    // Timestamps should be monotonically increasing
    expect(t2).toBeGreaterThan(t1)
    expect(t3).toBeGreaterThan(t2)

    // Document should have correct count
    expect(doc.state.count).toBe(3)
  })

  it("provides timestamp to handler", () => {
    const doc = createTypedDoc(TestSchema)
    const frontier = loro(doc).doc.frontiers()
    let capturedTimestamp: number | null = null

    const update = createUpdate<typeof TestSchema, TestMsg>(
      (workingDoc, msg, timestamp) => {
        capturedTimestamp = timestamp
        if (msg.type === "SET_COUNT") {
          change(workingDoc, draft => {
            draft.state.count = msg.value
          })
        }
      },
    )

    update(doc, frontier, { type: "SET_COUNT", value: 42 })

    expect(capturedTimestamp).not.toBeNull()
    expect(typeof capturedTimestamp).toBe("number")
  })

  it("does not modify document when handler makes no changes", () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "initial"
      draft.state.count = 10
    })

    const frontier = loro(doc).doc.frontiers()

    const update = createUpdate<typeof TestSchema, TestMsg>(
      (workingDoc, msg) => {
        // Guard: only process START if status is "idle"
        if (msg.type === "START" && workingDoc.state.status === "idle") {
          change(workingDoc, draft => {
            draft.state.status = "running"
          })
        }
      },
    )

    // This should not change anything because status is "initial", not "idle"
    const newFrontier = update(doc, frontier, { type: "START" })

    // Document should be unchanged
    expect(doc.state.status).toBe("initial")

    // Frontier should be the same (no changes made)
    expect(newFrontier).toEqual(frontier)
  })

  it("allows reading from working doc for guards", () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 5
    })

    const frontier = loro(doc).doc.frontiers()

    const update = createUpdate<typeof TestSchema, TestMsg>(
      (workingDoc, msg) => {
        // Read current state for guard
        if (msg.type === "INCREMENT" && workingDoc.state.count < 10) {
          change(workingDoc, draft => {
            draft.state.count = workingDoc.state.count + 1
          })
        }
      },
    )

    // Should increment because count (5) < 10
    update(doc, frontier, { type: "INCREMENT" })
    expect(doc.state.count).toBe(6)
  })
})

describe("getTimestampFromFrontier", () => {
  it("returns 0 for empty frontier", () => {
    const timestamp = getTimestampFromFrontier([])
    expect(timestamp).toBe(0)
  })

  it("returns monotonically increasing values as document changes", () => {
    const doc = createTypedDoc(TestSchema)

    const t1 = getTimestampFromFrontier(loro(doc).doc.frontiers())

    doc.change(draft => {
      draft.state.status = "a"
    })
    const t2 = getTimestampFromFrontier(loro(doc).doc.frontiers())

    doc.change(draft => {
      draft.state.status = "b"
    })
    const t3 = getTimestampFromFrontier(loro(doc).doc.frontiers())

    expect(t2).toBeGreaterThan(t1)
    expect(t3).toBeGreaterThan(t2)
  })
})
