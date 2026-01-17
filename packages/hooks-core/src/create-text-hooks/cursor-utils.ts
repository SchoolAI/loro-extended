import type { Delta } from "loro-crdt"

/**
 * Adjusts a cursor position based on a text delta.
 *
 * This function calculates the new cursor position after applying a delta
 * to the text. It handles insert, delete, and retain operations correctly,
 * ensuring the cursor stays in the right position relative to the content.
 *
 * @param cursorPos - The current cursor position (in the original text)
 * @param delta - The delta operations that were applied to the text
 * @returns The adjusted cursor position (in the new text)
 *
 * @example
 * ```ts
 * // Original text: "Hello World"
 * // Cursor at position 6 (before "W")
 * // Delta: [{ retain: 0 }, { insert: "Hi " }]
 * // Result: cursor moves to 9 (still before "W")
 * adjustCursorFromDelta(6, [{ retain: 0 }, { insert: "Hi " }]) // 9
 * ```
 */
export function adjustCursorFromDelta(
  cursorPos: number,
  delta: Delta<string>[],
): number {
  let adjustment = 0
  let oldPosition = 0 // Position in ORIGINAL text

  for (const op of delta) {
    if (op.retain !== undefined) {
      // Retain: move position forward in original text
      oldPosition += op.retain
    } else if (op.delete !== undefined) {
      // Delete: characters were removed
      const deleteEnd = oldPosition + op.delete
      if (deleteEnd <= cursorPos) {
        // Deletion is entirely before cursor - shift cursor left
        adjustment -= op.delete
      } else if (oldPosition < cursorPos) {
        // Deletion spans cursor - move cursor to deletion start
        adjustment -= cursorPos - oldPosition
      }
      // If deletion is entirely after cursor, no adjustment needed
      oldPosition += op.delete
    } else if (op.insert !== undefined) {
      // Insert: characters were added
      if (oldPosition <= cursorPos) {
        // Insertion is at or before cursor - shift cursor right
        adjustment += op.insert.length
      }
      // Note: oldPosition does NOT advance for inserts
      // because inserts don't consume original text positions
    }
  }

  return Math.max(0, cursorPos + adjustment)
}

/**
 * Adjusts a selection range based on a text delta.
 *
 * @param selectionStart - The start of the selection (in the original text)
 * @param selectionEnd - The end of the selection (in the original text)
 * @param delta - The delta operations that were applied to the text
 * @returns The adjusted selection range { start, end }
 */
export function adjustSelectionFromDelta(
  selectionStart: number,
  selectionEnd: number,
  delta: Delta<string>[],
): { start: number; end: number } {
  return {
    start: adjustCursorFromDelta(selectionStart, delta),
    end: adjustCursorFromDelta(selectionEnd, delta),
  }
}
