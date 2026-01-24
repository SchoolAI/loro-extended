import { createTypedDoc, Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { changed, entered, exited, transitioned } from "./helpers.js"
import type { Transition } from "./reactor-types.js"

// ═══════════════════════════════════════════════════════════════════════════
// Test Schema
// ═══════════════════════════════════════════════════════════════════════════

const TestSchema = Shape.doc({
  state: Shape.struct({
    status: Shape.plain.string(),
    count: Shape.plain.number(),
  }),
})

type TestTransition = Transition<typeof TestSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Helper to create transitions
// ═══════════════════════════════════════════════════════════════════════════

function createTransition(
  beforeStatus: string,
  afterStatus: string,
  beforeCount = 0,
  afterCount = 0,
): TestTransition {
  // Create "before" doc
  const beforeDoc = createTypedDoc(TestSchema)
  beforeDoc.change(draft => {
    draft.state.status = beforeStatus
    draft.state.count = beforeCount
  })

  // Create "after" doc
  const afterDoc = createTypedDoc(TestSchema)
  afterDoc.change(draft => {
    draft.state.status = afterStatus
    draft.state.count = afterCount
  })

  return {
    before: beforeDoc,
    after: afterDoc,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("entered", () => {
  it("returns true when value enters target state", () => {
    const transition = createTransition("idle", "running")
    const result = entered(doc => doc.state.status, "running", transition)
    expect(result).toBe(true)
  })

  it("returns false when value was already in target state", () => {
    const transition = createTransition("running", "running")
    const result = entered(doc => doc.state.status, "running", transition)
    expect(result).toBe(false)
  })

  it("returns false when value exits target state", () => {
    const transition = createTransition("running", "idle")
    const result = entered(doc => doc.state.status, "running", transition)
    expect(result).toBe(false)
  })

  it("returns false when value never was in target state", () => {
    const transition = createTransition("idle", "paused")
    const result = entered(doc => doc.state.status, "running", transition)
    expect(result).toBe(false)
  })
})

describe("exited", () => {
  it("returns true when value exits target state", () => {
    const transition = createTransition("running", "idle")
    const result = exited(doc => doc.state.status, "running", transition)
    expect(result).toBe(true)
  })

  it("returns false when value was not in target state", () => {
    const transition = createTransition("idle", "paused")
    const result = exited(doc => doc.state.status, "running", transition)
    expect(result).toBe(false)
  })

  it("returns false when value stays in target state", () => {
    const transition = createTransition("running", "running")
    const result = exited(doc => doc.state.status, "running", transition)
    expect(result).toBe(false)
  })

  it("returns false when value enters target state", () => {
    const transition = createTransition("idle", "running")
    const result = exited(doc => doc.state.status, "running", transition)
    expect(result).toBe(false)
  })
})

describe("changed", () => {
  it("returns true when value changes", () => {
    const transition = createTransition("idle", "running")
    const result = changed(doc => doc.state.status, transition)
    expect(result).toBe(true)
  })

  it("returns false when value stays the same", () => {
    const transition = createTransition("running", "running")
    const result = changed(doc => doc.state.status, transition)
    expect(result).toBe(false)
  })

  it("works with numeric values", () => {
    const transition = createTransition("idle", "idle", 0, 5)
    const result = changed(doc => doc.state.count, transition)
    expect(result).toBe(true)
  })

  it("returns false when numeric value stays the same", () => {
    const transition = createTransition("idle", "running", 5, 5)
    const result = changed(doc => doc.state.count, transition)
    expect(result).toBe(false)
  })
})

describe("transitioned", () => {
  it("returns true when value transitions from A to B", () => {
    const transition = createTransition("idle", "running")
    const result = transitioned(
      doc => doc.state.status,
      "idle",
      "running",
      transition,
    )
    expect(result).toBe(true)
  })

  it("returns false when value transitions from A to C (not B)", () => {
    const transition = createTransition("idle", "paused")
    const result = transitioned(
      doc => doc.state.status,
      "idle",
      "running",
      transition,
    )
    expect(result).toBe(false)
  })

  it("returns false when value transitions from C to B (not from A)", () => {
    const transition = createTransition("paused", "running")
    const result = transitioned(
      doc => doc.state.status,
      "idle",
      "running",
      transition,
    )
    expect(result).toBe(false)
  })

  it("returns false when value stays the same", () => {
    const transition = createTransition("idle", "idle")
    const result = transitioned(
      doc => doc.state.status,
      "idle",
      "running",
      transition,
    )
    expect(result).toBe(false)
  })
})
