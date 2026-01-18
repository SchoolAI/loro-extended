import { describe, expect, it } from "vitest"
import { calculateNewCursor } from "./input-handlers"

describe("calculateNewCursor", () => {
  describe("delete operations", () => {
    it("returns start position for deleteContentBackward with selection", () => {
      // Selection from 2 to 5, delete backward
      const result = calculateNewCursor("deleteContentBackward", 2, 5, null, 10)
      expect(result).toBe(2) // Cursor goes to start of selection
    })

    it("returns start-1 for deleteContentBackward without selection", () => {
      // Cursor at position 5, no selection
      const result = calculateNewCursor("deleteContentBackward", 5, 5, null, 10)
      expect(result).toBe(4) // Cursor moves back one
    })

    it("returns start position for deleteWordBackward", () => {
      // deleteWordBackward is a delete operation
      const result = calculateNewCursor("deleteWordBackward", 5, 5, null, 10)
      expect(result).toBe(4)
    })

    it("returns start position for deleteWordForward", () => {
      // deleteWordForward is a delete operation
      const result = calculateNewCursor("deleteWordForward", 5, 5, null, 10)
      expect(result).toBe(4)
    })

    it("returns start position for deleteSoftLineBackward", () => {
      const result = calculateNewCursor(
        "deleteSoftLineBackward",
        5,
        5,
        null,
        10,
      )
      expect(result).toBe(4)
    })

    it("returns start position for deleteSoftLineForward", () => {
      const result = calculateNewCursor("deleteSoftLineForward", 5, 5, null, 10)
      expect(result).toBe(4)
    })

    it("returns 0 when deleting at position 0", () => {
      const result = calculateNewCursor("deleteContentBackward", 0, 0, null, 10)
      expect(result).toBe(0) // Can't go below 0
    })
  })

  describe("insert operations", () => {
    it("returns start + data.length for insertText", () => {
      const result = calculateNewCursor("insertText", 5, 5, "Hello", 20)
      expect(result).toBe(10) // 5 + 5 ("Hello".length)
    })

    it("handles null data by defaulting to 1", () => {
      const result = calculateNewCursor("insertText", 5, 5, null, 20)
      expect(result).toBe(6) // 5 + 1 (default)
    })

    it("returns start + 1 for insertLineBreak", () => {
      const result = calculateNewCursor("insertLineBreak", 5, 5, null, 20)
      expect(result).toBe(6) // 5 + 1 (newline)
    })

    it("returns start + 1 for insertParagraph", () => {
      const result = calculateNewCursor("insertParagraph", 5, 5, null, 20)
      expect(result).toBe(6) // 5 + 1 (newline)
    })

    it("returns start + data.length for insertFromPaste", () => {
      const result = calculateNewCursor(
        "insertFromPaste",
        0,
        0,
        "Pasted text",
        20,
      )
      expect(result).toBe(11) // 0 + 11 ("Pasted text".length)
    })
  })

  describe("maxLength clamping", () => {
    it("clamps result to maxLength", () => {
      // Insert would put cursor at position 15, but maxLength is 10
      const result = calculateNewCursor("insertText", 5, 5, "Hello World", 10)
      expect(result).toBe(10) // Clamped to maxLength
    })

    it("does not clamp when result is within bounds", () => {
      const result = calculateNewCursor("insertText", 5, 5, "Hi", 20)
      expect(result).toBe(7) // 5 + 2, within bounds
    })
  })

  describe("selection replacement", () => {
    it("calculates cursor after replacing selection with text", () => {
      // Selection from 2 to 8, replace with "new"
      const result = calculateNewCursor("insertText", 2, 8, "new", 20)
      expect(result).toBe(5) // 2 + 3 ("new".length)
    })

    it("calculates cursor after deleting selection", () => {
      // Selection from 2 to 8, delete
      const result = calculateNewCursor("deleteContentBackward", 2, 8, null, 20)
      expect(result).toBe(2) // Cursor at start of deleted selection
    })
  })
})
