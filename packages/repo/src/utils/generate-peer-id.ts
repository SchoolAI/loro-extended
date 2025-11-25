import type { PeerID } from "../types.js"

/**
 * Generate a cryptographically random PeerID.
 *
 * PeerID must be an unsigned 64-bit integer represented as a decimal string.
 * This function uses crypto.getRandomValues to generate a random 64-bit value
 * that is globally unique with extremely high probability.
 *
 * @returns A random PeerID suitable for use with Loro
 *
 * @example
 * ```typescript
 * const peerId = generatePeerId()
 * doc.setPeerId(peerId)
 * ```
 */
export function generatePeerId(): PeerID {
  // Generate 8 random bytes (64 bits)
  const randomBytes = new Uint8Array(8)
  crypto.getRandomValues(randomBytes)

  // Convert to a 64-bit unsigned integer
  const view = new DataView(randomBytes.buffer)
  const randomBigInt = view.getBigUint64(0, false) // false = big-endian

  // Convert to decimal string and cast to PeerID type
  return `${randomBigInt}` as PeerID
}
