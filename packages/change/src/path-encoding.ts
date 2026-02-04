/**
 * Path encoding utilities for flattened root container storage.
 *
 * When `mergeable: true` is set on a TypedDoc, all containers are stored at the
 * document root with path-based names. This ensures container IDs are deterministic
 * and survive `applyDiff`, enabling proper merging of concurrent container creation.
 *
 * Path encoding scheme:
 * - Separator: `-` (hyphen) - consistent with Loro's `cid:root-{name}` convention
 * - Escape character: `\` (backslash)
 * - Literal hyphen in key: `\-`
 * - Literal backslash in key: `\\`
 *
 * Examples:
 * | Schema Path | Encoded Root Name | Container ID |
 * |-------------|-------------------|--------------|
 * | `data.items` | `data-items` | `cid:root-data-items:List` |
 * | `data["my-key"].value` | `data-my\-key-value` | `cid:root-data-my\-key-value:Map` |
 * | `players.alice.score` | `players-alice-score` | `cid:root-players-alice-score:Map` |
 */

/**
 * Escape a path segment for use in root container names.
 * Escapes backslashes first, then hyphens.
 *
 * @param segment - A single path segment (key name)
 * @returns The escaped segment safe for use in hyphen-separated paths
 *
 * @example
 * escapePathSegment("data") // "data"
 * escapePathSegment("my-key") // "my\\-key"
 * escapePathSegment("path\\to") // "path\\\\to"
 * escapePathSegment("a\\-b") // "a\\\\\\-b"
 */
export function escapePathSegment(segment: string): string {
  // Order matters: escape backslashes first, then hyphens
  return segment.replace(/\\/g, "\\\\").replace(/-/g, "\\-")
}

/**
 * Build a root container name from path segments.
 * Each segment is escaped and joined with hyphens.
 *
 * @param segments - Array of path segments (key names)
 * @returns The encoded root container name
 *
 * @example
 * buildRootContainerName(["data", "nested", "items"]) // "data-nested-items"
 * buildRootContainerName(["data", "my-key", "value"]) // "data-my\\-key-value"
 * buildRootContainerName(["config", "api-url"]) // "config-api\\-url"
 */
export function buildRootContainerName(segments: string[]): string {
  return segments.map(escapePathSegment).join("-")
}

/**
 * Parse a root container name back to path segments.
 * Handles escape sequences for literal hyphens and backslashes.
 *
 * @param name - The encoded root container name
 * @returns Array of path segments (key names)
 *
 * @example
 * parseRootContainerName("data-nested-items") // ["data", "nested", "items"]
 * parseRootContainerName("data-my\\-key-value") // ["data", "my-key", "value"]
 * parseRootContainerName("config-api\\-url") // ["config", "api-url"]
 */
export function parseRootContainerName(name: string): string[] {
  const result: string[] = []
  let current = ""
  let i = 0

  while (i < name.length) {
    if (name[i] === "\\") {
      // Escape sequence
      if (name[i + 1] === "-") {
        // Escaped hyphen: literal hyphen in key
        current += "-"
        i += 2
      } else if (name[i + 1] === "\\") {
        // Escaped backslash: literal backslash in key
        current += "\\"
        i += 2
      } else {
        // Invalid escape sequence, treat as literal backslash
        current += "\\"
        i += 1
      }
    } else if (name[i] === "-") {
      // Path separator
      result.push(current)
      current = ""
      i += 1
    } else {
      // Regular character
      current += name[i]
      i += 1
    }
  }

  // Don't forget the last segment
  result.push(current)

  return result
}
