import type { Delta } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { adjustCursorFromDelta, adjustSelectionFromDelta } from "./cursor-utils"

describe("adjustCursorFromDelta", () => {
  describe("insert operations", () => {
    it("should shift cursor right when insert is before cursor", () => {
      // Original: "Hello World" (cursor at 6, before "W")
      // Delta: insert "Hi " at position 0
      // Result: cursor should be at 9 (still before "W")
      const ops: Delta<string>[] = [{ insert: "Hi " }]
      expect(adjustCursorFromDelta(6, ops)).toBe(9)
    })

    it("should shift cursor right when insert is at cursor position", () => {
      // Original: "Hello World" (cursor at 5, after "Hello")
      // Delta: retain 5, insert " there"
      // Result: cursor should be at 11 (after " there")
      const ops: Delta<string>[] = [{ retain: 5 }, { insert: " there" }]
      expect(adjustCursorFromDelta(5, ops)).toBe(11)
    })

    it("should not shift cursor when insert is after cursor", () => {
      // Original: "Hello World" (cursor at 2, after "He")
      // Delta: retain 6, insert "Beautiful "
      // Result: cursor should stay at 2
      const ops: Delta<string>[] = [{ retain: 6 }, { insert: "Beautiful " }]
      expect(adjustCursorFromDelta(2, ops)).toBe(2)
    })

    it("should handle insert at the beginning", () => {
      // Original: "World" (cursor at 0)
      // Delta: insert "Hello "
      // Result: cursor should be at 6
      const ops: Delta<string>[] = [{ insert: "Hello " }]
      expect(adjustCursorFromDelta(0, ops)).toBe(6)
    })
  })

  describe("delete operations", () => {
    it("should shift cursor left when delete is entirely before cursor", () => {
      // Original: "Hello World" (cursor at 8, after "Wor")
      // Delta: delete 6 (removes "Hello ")
      // Result: cursor should be at 2 (still after "Wor")
      const ops: Delta<string>[] = [{ delete: 6 }]
      expect(adjustCursorFromDelta(8, ops)).toBe(2)
    })

    it("should move cursor to delete start when delete spans cursor", () => {
      // Original: "Hello World" (cursor at 7, in the middle of "World")
      // Delta: retain 6, delete 5 (removes "World")
      // Result: cursor should be at 6 (at the deletion point)
      const ops: Delta<string>[] = [{ retain: 6 }, { delete: 5 }]
      expect(adjustCursorFromDelta(7, ops)).toBe(6)
    })

    it("should not shift cursor when delete is entirely after cursor", () => {
      // Original: "Hello World" (cursor at 2, after "He")
      // Delta: retain 6, delete 5 (removes "World")
      // Result: cursor should stay at 2
      const ops: Delta<string>[] = [{ retain: 6 }, { delete: 5 }]
      expect(adjustCursorFromDelta(2, ops)).toBe(2)
    })

    it("should handle delete at cursor position", () => {
      // Original: "Hello World" (cursor at 5, after "Hello")
      // Delta: retain 5, delete 1 (removes " ")
      // Result: cursor should stay at 5
      const ops: Delta<string>[] = [{ retain: 5 }, { delete: 1 }]
      expect(adjustCursorFromDelta(5, ops)).toBe(5)
    })
  })

  describe("retain operations", () => {
    it("should not affect cursor with retain only", () => {
      // Original: "Hello World" (cursor at 5)
      // Delta: retain 11 (no changes)
      // Result: cursor should stay at 5
      const ops: Delta<string>[] = [{ retain: 11 }]
      expect(adjustCursorFromDelta(5, ops)).toBe(5)
    })
  })

  describe("complex operations", () => {
    it("should handle multiple operations in sequence", () => {
      // Original: "Hello World" (cursor at 6, before "W")
      // Delta: retain 5, delete 1, insert " Beautiful "
      // This removes " " and inserts " Beautiful " at position 5
      // Result: cursor should be at 16 (before "W" which is now at position 16)
      const ops: Delta<string>[] = [
        { retain: 5 },
        { delete: 1 },
        { insert: " Beautiful " },
      ]
      expect(adjustCursorFromDelta(6, ops)).toBe(16)
    })

    it("should handle insert and delete together", () => {
      // Original: "abc" (cursor at 2, after "ab")
      // Delta: delete 1, insert "xy"
      // Removes "a", inserts "xy" at start
      // Result: cursor should be at 3 (still after what was "ab", now "xyb")
      const ops: Delta<string>[] = [{ delete: 1 }, { insert: "xy" }]
      expect(adjustCursorFromDelta(2, ops)).toBe(3)
    })

    it("should handle cursor at position 0", () => {
      // Original: "Hello" (cursor at 0)
      // Delta: insert "Hi "
      // Result: cursor should be at 3
      const ops: Delta<string>[] = [{ insert: "Hi " }]
      expect(adjustCursorFromDelta(0, ops)).toBe(3)
    })

    it("should handle cursor at end of text", () => {
      // Original: "Hello" (cursor at 5, at end)
      // Delta: retain 5, insert " World"
      // Result: cursor should be at 11 (at new end)
      const ops: Delta<string>[] = [{ retain: 5 }, { insert: " World" }]
      expect(adjustCursorFromDelta(5, ops)).toBe(11)
    })

    it("should never return negative cursor position", () => {
      // Original: "Hi" (cursor at 1)
      // Delta: delete 10 (more than text length - edge case)
      // Result: cursor should be at 0 (clamped)
      const ops: Delta<string>[] = [{ delete: 10 }]
      expect(adjustCursorFromDelta(1, ops)).toBe(0)
    })
  })

  describe("empty delta", () => {
    it("should not change cursor with empty delta", () => {
      const ops: Delta<string>[] = []
      expect(adjustCursorFromDelta(5, ops)).toBe(5)
    })
  })
})

describe("adjustSelectionFromDelta", () => {
  it("should adjust both start and end of selection", () => {
    // Original: "Hello World" (selection from 0 to 5, selecting "Hello")
    // Delta: insert "Hi " at start
    // Result: selection should be from 3 to 8
    const ops: Delta<string>[] = [{ insert: "Hi " }]
    const result = adjustSelectionFromDelta(0, 5, ops)
    expect(result.start).toBe(3)
    expect(result.end).toBe(8)
  })

  it("should handle selection that spans a delete", () => {
    // Original: "Hello World" (selection from 3 to 8)
    // Delta: retain 4, delete 3 (removes "o W")
    // Result: selection should collapse appropriately
    const ops: Delta<string>[] = [{ retain: 4 }, { delete: 3 }]
    const result = adjustSelectionFromDelta(3, 8, ops)
    expect(result.start).toBe(3)
    expect(result.end).toBe(5) // 8 - 3 = 5
  })

  it("should handle collapsed selection (cursor)", () => {
    // Original: "Hello" (cursor at 3, no selection)
    // Delta: insert "X" at position 0
    // Result: cursor should be at 4
    const ops: Delta<string>[] = [{ insert: "X" }]
    const result = adjustSelectionFromDelta(3, 3, ops)
    expect(result.start).toBe(4)
    expect(result.end).toBe(4)
  })
})
