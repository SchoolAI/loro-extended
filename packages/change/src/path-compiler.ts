// ============================================================================
// JSONPath Compiler
// ============================================================================
//
// Compiles PathSelector segments to JSONPath strings for use with
// subscribeJsonpath.

import type { PathSegment } from "./path-selector.js"

/**
 * Compiles path segments to a JSONPath string.
 *
 * @example
 * ```typescript
 * const segments = [
 *   { type: "property", key: "books" },
 *   { type: "each" },
 *   { type: "property", key: "title" }
 * ]
 * compileToJsonPath(segments) // => '$.books[*].title'
 * ```
 */
export function compileToJsonPath(segments: PathSegment[]): string {
  let path = "$"

  for (const segment of segments) {
    switch (segment.type) {
      case "property":
        // Use dot notation for simple identifiers, bracket notation for safety
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(segment.key)) {
          path += `.${segment.key}`
        } else {
          path += `["${escapeJsonPathKey(segment.key)}"]`
        }
        break
      case "each":
        path += "[*]"
        break
      case "index":
        path += `[${segment.index}]`
        break
      case "key":
        path += `["${escapeJsonPathKey(segment.key)}"]`
        break
    }
  }

  return path
}

/**
 * Escapes special characters in a JSONPath key.
 */
function escapeJsonPathKey(key: string): string {
  return key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * Check if the path contains any wildcard segments.
 * Paths with wildcards need deep equality checking for change detection.
 */
export function hasWildcard(segments: PathSegment[]): boolean {
  return segments.some(s => s.type === "each")
}
