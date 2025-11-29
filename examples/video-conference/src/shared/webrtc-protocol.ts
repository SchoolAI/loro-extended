import type { PeerID } from "@loro-extended/repo"

/**
 * Determines which peer should initiate the WebRTC connection.
 *
 * WebRTC requires exactly one peer to create an offer (initiator) and
 * the other to create an answer. Without coordination, both peers might
 * try to initiate simultaneously ("glare").
 *
 * We use deterministic ordering: the peer with the numerically smaller
 * peerId always initiates. Since peerIds are large numeric strings,
 * we use BigInt comparison.
 *
 * @param myPeerId - The local peer's ID
 * @param remotePeerId - The remote peer's ID
 * @returns true if the local peer should initiate the connection
 */
export function shouldInitiate(
  myPeerId: PeerID,
  remotePeerId: PeerID,
): boolean {
  return BigInt(myPeerId) < BigInt(remotePeerId)
}

/**
 * Fast synchronous hash function using cyrb53 algorithm.
 * Produces a 53-bit hash with good distribution, suitable for deduplication.
 *
 * Based on: https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 *
 * @param str - The string to hash
 * @param seed - Optional seed for the hash (default: 0)
 * @returns A 14-character hex string
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  // Combine into a 53-bit value and convert to hex
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return hash.toString(16).padStart(14, "0")
}

/**
 * Computes a fast hash of a message and returns a fixed-size hex string.
 * Uses cyrb53 algorithm which is fast and has good distribution.
 *
 * Note: This is NOT cryptographically secure. For cryptographic purposes,
 * use Web Crypto API's crypto.subtle.digest instead.
 *
 * @param message - The string to hash
 * @returns A 14-character hex string
 */
export function fastHash(message: string): string {
  return cyrb53(message)
}

/**
 * Creates a unique identifier for a signal to enable deduplication.
 *
 * Signals can be received multiple times through presence updates,
 * so we need to track which ones we've already processed.
 *
 * Uses a fast hash to create a fixed-size ID, avoiding memory issues
 * with large signal payloads (like SDP offers which can be several KB).
 *
 * @param fromPeerId - The peer ID that sent the signal
 * @param signal - The signal data
 * @returns A fixed-size hex string unique to this signal
 */
export function createSignalId(fromPeerId: PeerID, signal: unknown): string {
  const content = `${fromPeerId}:${JSON.stringify(signal)}`
  return fastHash(content)
}

/**
 * ICE servers configuration for WebRTC connections.
 * These STUN servers help peers discover their public IP addresses
 * for NAT traversal.
 */
export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
]
