import type { PeerID } from "../types.js"

/**
 * Validates that a peerId is compatible with Loro's `${number}` PeerID type.
 * A valid peerId must be a string representing a non-negative integer (unsigned 64-bit).
 *
 * @param peerId - The peerId string to validate
 * @throws Error if the peerId is not a valid numeric string
 */
export function validatePeerId(peerId: string): asserts peerId is PeerID {
  // Must be a non-empty string of digits only (no leading zeros except for "0" itself)
  if (!/^(0|[1-9]\d*)$/.test(peerId)) {
    throw new Error(
      `Invalid peerId: "${peerId}". PeerID must be a non-negative integer string (e.g., "123456789").`
    )
  }

  // Check if it's within unsigned 64-bit integer range (0 to 2^64 - 1)
  const MAX_UINT64 = BigInt("18446744073709551615") // 2^64 - 1
  try {
    const value = BigInt(peerId)
    if (value < 0n || value > MAX_UINT64) {
      throw new Error(
        `Invalid peerId: "${peerId}". PeerID must be within unsigned 64-bit integer range (0 to ${MAX_UINT64}).`
      )
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Invalid peerId:")) {
      throw e
    }
    throw new Error(
      `Invalid peerId: "${peerId}". PeerID must be a valid integer string.`
    )
  }
}