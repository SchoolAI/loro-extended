import type { TextRef } from "@loro-extended/change"
import { loro } from "@loro-extended/change"

/**
 * Get the container ID for a TextRef.
 *
 * This utility provides a consistent way to get the container ID
 * across different parts of the codebase (CursorRegistry, UndoManager, etc.).
 *
 * The container ID is stable and unique within a document, making it
 * suitable for use as a key in maps and for cursor restoration.
 *
 * @param textRef - The TextRef to get the container ID for
 * @returns The container ID as a string
 */
export function getContainerIdFromTextRef(textRef: TextRef): string {
  return loro(textRef).container.id.toString()
}
