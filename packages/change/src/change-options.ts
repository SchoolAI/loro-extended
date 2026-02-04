/**
 * Options for the change() function.
 *
 * These options can be passed to change() when mutating TypedDoc, TypedRef, or Lens.
 */
export interface ChangeOptions {
  /**
   * Commit message to attach to the change.
   *
   * This message will be stored in the Loro commit and is available
   * in filters via `CommitInfo.message`.
   *
   * If an object is provided, it will be automatically JSON-serialized.
   *
   * @example
   * ```typescript
   * // String message
   * change(doc, draft => { ... }, { commitMessage: "player-move" })
   *
   * // Object message (auto-serialized to JSON)
   * change(doc, draft => { ... }, { commitMessage: { playerId: "alice" } })
   * ```
   */
  commitMessage?: string | object
}

/**
 * Serialize a commit message to a string.
 *
 * - String messages are returned as-is
 * - Object messages are JSON-serialized
 * - Handles serialization errors gracefully (returns undefined)
 *
 * @param message - The message to serialize (string, object, or undefined)
 * @returns The serialized message string, or undefined
 */
export function serializeCommitMessage(
  message: string | object | undefined,
): string | undefined {
  if (message === undefined) return undefined
  if (typeof message === "string") return message
  try {
    return JSON.stringify(message)
  } catch {
    // Handle circular references, BigInt, etc.
    return undefined
  }
}
