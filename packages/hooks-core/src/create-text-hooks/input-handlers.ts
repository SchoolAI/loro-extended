import type { TextRef } from "@loro-extended/change"

/**
 * Context passed to input handlers containing all necessary information
 * to process an input event.
 */
export interface InputContext {
  /** The TextRef to modify */
  textRef: TextRef
  /** Selection start position */
  start: number
  /** Selection end position */
  end: number
  /** Data from the input event (text to insert, if any) */
  data: string | null
  /** The input element */
  input: HTMLInputElement | HTMLTextAreaElement
  /** The original input event */
  event: InputEvent
}

/**
 * Handler function for a specific input type.
 */
export type InputHandler = (ctx: InputContext) => void

/**
 * Handles text insertion (typing, paste, drop).
 */
function handleInsertText(ctx: InputContext): void {
  const { textRef, start, end, data } = ctx
  // Delete selected text first, then insert
  if (start !== end) {
    textRef.delete(start, end - start)
  }
  if (data) {
    textRef.insert(start, data)
  }
}

/**
 * Handles line break insertion (Enter key).
 */
function handleInsertLineBreak(ctx: InputContext): void {
  const { textRef, start, end } = ctx
  // Delete selected text first, then insert newline
  if (start !== end) {
    textRef.delete(start, end - start)
  }
  textRef.insert(start, "\n")
}

/**
 * Handles backward deletion (Backspace key).
 */
function handleDeleteBackward(ctx: InputContext): void {
  const { textRef, start, end } = ctx
  if (start !== end) {
    textRef.delete(start, end - start)
  } else if (start > 0) {
    textRef.delete(start - 1, 1)
  }
}

/**
 * Handles forward deletion (Delete key).
 */
function handleDeleteForward(ctx: InputContext): void {
  const { textRef, start, end, input } = ctx
  if (start !== end) {
    textRef.delete(start, end - start)
  } else if (start < input.value.length) {
    textRef.delete(start, 1)
  }
}

/**
 * Handles selection deletion (Cut operation).
 */
function handleDeleteSelection(ctx: InputContext): void {
  const { textRef, start, end } = ctx
  if (start !== end) {
    textRef.delete(start, end - start)
  }
}

/**
 * Handles word/line deletions using getTargetRanges().
 */
function handleDeleteByRange(ctx: InputContext): void {
  const { textRef, start, end, event } = ctx
  // For word/line deletions, use getTargetRanges() if available
  const ranges = event.getTargetRanges()
  if (ranges.length > 0) {
    const range = ranges[0]
    // Get the actual offsets from the range
    const deleteStart = range.startOffset
    const deleteEnd = range.endOffset
    if (deleteEnd > deleteStart) {
      textRef.delete(deleteStart, deleteEnd - deleteStart)
    }
  } else if (start !== end) {
    // Fallback: delete selection
    textRef.delete(start, end - start)
  }
}

/**
 * Map of input types to their handler functions.
 * This implements the strategy pattern for handling different input types.
 */
export const inputHandlers: Record<string, InputHandler> = {
  // Text insertion
  insertText: handleInsertText,
  insertFromPaste: handleInsertText,
  insertFromDrop: handleInsertText,

  // Line breaks
  insertLineBreak: handleInsertLineBreak,
  insertParagraph: handleInsertLineBreak,

  // Simple deletions
  deleteContentBackward: handleDeleteBackward,
  deleteContentForward: handleDeleteForward,
  deleteByCut: handleDeleteSelection,

  // Word/line deletions (use getTargetRanges)
  deleteWordBackward: handleDeleteByRange,
  deleteWordForward: handleDeleteByRange,
  deleteSoftLineBackward: handleDeleteByRange,
  deleteSoftLineForward: handleDeleteByRange,
  deleteHardLineBackward: handleDeleteByRange,
  deleteHardLineForward: handleDeleteByRange,
}

/**
 * Calculates the new cursor position after an input operation.
 *
 * @param inputType - The type of input that was performed
 * @param start - The original selection start
 * @param end - The original selection end
 * @param data - The data that was inserted (if any)
 * @param maxLength - The maximum valid cursor position
 * @returns The new cursor position
 */
export function calculateNewCursor(
  inputType: string,
  start: number,
  end: number,
  data: string | null,
  maxLength: number,
): number {
  let newCursor: number
  if (inputType.startsWith("delete")) {
    newCursor = start !== end ? start : Math.max(0, start - 1)
  } else {
    newCursor = start + (data?.length ?? 1)
  }
  return Math.min(newCursor, maxLength)
}
