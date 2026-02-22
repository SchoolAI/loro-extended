/**
 * Tests for useValue() hook nullish handling
 *
 * These tests verify that useValue() correctly handles undefined and null inputs,
 * enabling patterns like `useValue(record.get("key"))` where get() may return undefined.
 */

import { change, createTypedDoc, Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { act, renderHook, useValue, waitFor } from "./test-utils"

describe("useValue() nullish handling", () => {
  it("returns undefined when given undefined", () => {
    const { result } = renderHook(() => useValue(undefined))
    expect(result.current).toBeUndefined()
  })

  it("returns null when given null", () => {
    const { result } = renderHook(() => useValue(null))
    expect(result.current).toBeNull()
  })

  it("handles PlainValueRef | undefined from record.get()", () => {
    const schema = Shape.doc({
      players: Shape.record(
        Shape.plain.struct({
          choice: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    // Player doesn't exist yet - get returns undefined
    const player = doc.players.get("alice")
    expect(player).toBeUndefined()

    // useValue() handles the undefined - returns undefined
    const { result } = renderHook(() => useValue(player))
    expect(result.current).toBeUndefined()
  })

  it("handles PlainValueRef when defined", () => {
    const schema = Shape.doc({
      players: Shape.record(
        Shape.plain.struct({
          choice: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    // Add the player
    change(doc, draft => {
      draft.players.set("alice", { choice: "rock" })
    })

    // Now player exists - useValue() unwraps the PlainValueRef
    const player = doc.players.get("alice")
    expect(player).toBeDefined()

    const { result } = renderHook(() => useValue(player))
    expect(result.current).toEqual({ choice: "rock" })
  })

  it("handles null choice value stored in CRDT", () => {
    const schema = Shape.doc({
      players: Shape.record(
        Shape.plain.struct({
          choice: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.players.set("alice", { choice: null })
    })

    const player = doc.players.get("alice")
    const { result } = renderHook(() => useValue(player))

    // The choice is explicitly null (stored in the CRDT)
    expect(result.current?.choice).toBeNull()
  })

  it("handles TypedRef (StructRef) when defined", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        name: Shape.plain.string(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.name = "Test"
    })

    // useValue() on StructRef calls toJSON()
    const { result } = renderHook(() => useValue(doc.data))
    expect(result.current).toEqual({ name: "Test" })
  })

  it("handles TypedDoc when defined", () => {
    const schema = Shape.doc({
      count: Shape.counter(),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.count.increment(5)
    })

    // useValue() on TypedDoc calls toJSON()
    const { result } = renderHook(() => useValue(doc))
    expect(result.current).toEqual({ count: 5 })
  })
})

describe("useValue() reactivity", () => {
  it("updates when PlainValueRef value changes", async () => {
    const schema = Shape.doc({
      data: Shape.struct({
        title: Shape.plain.string(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.title = "Initial"
    })

    const { result } = renderHook(() => useValue(doc.data.title))
    expect(result.current).toBe("Initial")

    // Change the value
    act(() => {
      change(doc, draft => {
        draft.data.title = "Updated"
      })
    })

    // Should update reactively
    await waitFor(() => {
      expect(result.current).toBe("Updated")
    })
  })

  it("updates when StructRef value changes", async () => {
    const schema = Shape.doc({
      data: Shape.struct({
        name: Shape.plain.string(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.name = "Alice"
    })

    const { result } = renderHook(() => useValue(doc.data))
    expect(result.current).toEqual({ name: "Alice" })

    // Change the value
    act(() => {
      change(doc, draft => {
        draft.data.name = "Bob"
      })
    })

    // Should update reactively
    await waitFor(() => {
      expect(result.current).toEqual({ name: "Bob" })
    })
  })

  it("updates when TypedDoc value changes", async () => {
    const schema = Shape.doc({
      count: Shape.counter(),
    })
    const doc = createTypedDoc(schema)

    const { result } = renderHook(() => useValue(doc))
    expect(result.current).toEqual({ count: 0 })

    // Change the value
    act(() => {
      change(doc, draft => {
        draft.count.increment(10)
      })
    })

    // Should update reactively
    await waitFor(() => {
      expect(result.current).toEqual({ count: 10 })
    })
  })

  it("does not subscribe when input is undefined", () => {
    // This test verifies we don't try to subscribe to null containers
    const { result, rerender } = renderHook(() => useValue(undefined))

    expect(result.current).toBeUndefined()

    // Re-render should still work without errors
    rerender()
    expect(result.current).toBeUndefined()
  })

  it("does not subscribe when input is null", () => {
    // This test verifies we don't try to subscribe to null containers
    const { result, rerender } = renderHook(() => useValue(null))

    expect(result.current).toBeNull()

    // Re-render should still work without errors
    rerender()
    expect(result.current).toBeNull()
  })

  it("handles ref transitioning from undefined to defined", async () => {
    const schema = Shape.doc({
      players: Shape.record(
        Shape.plain.struct({
          choice: Shape.plain.string(),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    // Start with undefined ref
    let playerRef = doc.players.get("alice")
    expect(playerRef).toBeUndefined()

    const { result, rerender } = renderHook(({ ref }) => useValue(ref), {
      initialProps: { ref: playerRef },
    })

    expect(result.current).toBeUndefined()

    // Add the player
    act(() => {
      change(doc, draft => {
        draft.players.set("alice", { choice: "rock" })
      })
    })

    // Update the ref and re-render
    playerRef = doc.players.get("alice")
    rerender({ ref: playerRef })

    // Should now have the value
    await waitFor(() => {
      expect(result.current).toEqual({ choice: "rock" })
    })
  })
})
