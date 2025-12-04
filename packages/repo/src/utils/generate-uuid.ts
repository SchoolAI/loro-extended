/**
 * Generate a UUID v4 string.
 *
 * Uses `crypto.randomUUID()` when available (secure contexts: HTTPS or localhost).
 * Falls back to a `crypto.getRandomValues()` based implementation for non-secure
 * contexts (e.g., HTTP on LAN IP addresses).
 *
 * @returns A UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  // Fallback using crypto.getRandomValues (available in all browser contexts)
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (
      +c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
    ).toString(16),
  )
}