/**
 * Transport-level fragmentation for large payloads.
 *
 * This module provides pure functions for fragmenting and parsing
 * transport payloads. The stateful reassembly logic is in `reassembler.ts`.
 *
 * Fragmentation uses byte-prefix discriminators to distinguish between:
 * - Complete messages (0x00)
 * - Fragment headers (0x01)
 * - Fragment data chunks (0x02)
 *
 * This avoids double CBOR encoding and keeps the framed payload as raw bytes.
 */

/**
 * Byte prefix for a complete (non-fragmented) message.
 * Followed by the framed CBOR message.
 */
export const MESSAGE_COMPLETE = 0x00

/**
 * Byte prefix for a fragment header.
 * Followed by: batchId (8 bytes) + count (4 bytes, big-endian) + totalSize (4 bytes, big-endian)
 */
export const FRAGMENT_HEADER = 0x01

/**
 * Byte prefix for fragment data.
 * Followed by: batchId (8 bytes) + index (4 bytes, big-endian) + data (remaining bytes)
 */
export const FRAGMENT_DATA = 0x02

/** Size of batch ID in bytes */
export const BATCH_ID_SIZE = 8

/** Size of fragment header payload (excluding prefix): batchId + count + totalSize */
export const FRAGMENT_HEADER_PAYLOAD_SIZE = BATCH_ID_SIZE + 4 + 4

/** Minimum size of fragment data payload (excluding prefix): batchId + index + at least 1 byte */
export const FRAGMENT_DATA_MIN_SIZE = BATCH_ID_SIZE + 4 + 1

/**
 * Transport payload discriminated union.
 */
export type TransportPayload =
  | { kind: "message"; data: Uint8Array }
  | {
      kind: "fragment-header"
      batchId: Uint8Array
      count: number
      totalSize: number
    }
  | {
      kind: "fragment-data"
      batchId: Uint8Array
      index: number
      data: Uint8Array
    }

/**
 * Error thrown when parsing transport payloads fails.
 */
export class FragmentParseError extends Error {
  override readonly name = "FragmentParseError"

  constructor(
    public readonly code:
      | "unknown_prefix"
      | "truncated_header"
      | "truncated_data"
      | "invalid_count"
      | "invalid_size",
    message: string,
  ) {
    super(message)
  }
}

/**
 * Error thrown when reassembling fragments fails.
 */
export class FragmentReassembleError extends Error {
  override readonly name = "FragmentReassembleError"

  constructor(
    public readonly code:
      | "missing_fragments"
      | "size_mismatch"
      | "invalid_index",
    message: string,
  ) {
    super(message)
  }
}

/**
 * Generate a random 8-byte batch ID using crypto.getRandomValues.
 *
 * @returns 8-byte Uint8Array batch ID
 */
export function generateBatchId(): Uint8Array {
  const id = new Uint8Array(BATCH_ID_SIZE)
  crypto.getRandomValues(id)
  return id
}

/**
 * Convert a batch ID to a hex string for use as a Map key.
 *
 * @param id - 8-byte batch ID
 * @returns Hex-encoded string (16 characters)
 */
export function batchIdToKey(id: Uint8Array): string {
  let hex = ""
  for (let i = 0; i < id.length; i++) {
    hex += id[i].toString(16).padStart(2, "0")
  }
  return hex
}

/**
 * Convert a hex string key back to a batch ID.
 *
 * @param key - Hex-encoded string (16 characters)
 * @returns 8-byte Uint8Array batch ID
 */
export function keyToBatchId(key: string): Uint8Array {
  const id = new Uint8Array(BATCH_ID_SIZE)
  for (let i = 0; i < BATCH_ID_SIZE; i++) {
    id[i] = Number.parseInt(key.slice(i * 2, i * 2 + 2), 16)
  }
  return id
}

/**
 * Wrap a complete message with the MESSAGE_COMPLETE prefix.
 *
 * @param data - The framed message data
 * @returns Prefixed transport payload
 */
export function wrapCompleteMessage(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(1 + data.length)
  result[0] = MESSAGE_COMPLETE
  result.set(data, 1)
  return result
}

/**
 * Create a fragment header payload.
 *
 * @param batchId - 8-byte batch ID
 * @param count - Number of fragments in this batch
 * @param totalSize - Total size of the original payload in bytes
 * @returns Fragment header transport payload
 */
export function createFragmentHeader(
  batchId: Uint8Array,
  count: number,
  totalSize: number,
): Uint8Array {
  const result = new Uint8Array(1 + FRAGMENT_HEADER_PAYLOAD_SIZE)
  const view = new DataView(result.buffer)

  result[0] = FRAGMENT_HEADER
  result.set(batchId, 1)
  view.setUint32(1 + BATCH_ID_SIZE, count, false) // big-endian
  view.setUint32(1 + BATCH_ID_SIZE + 4, totalSize, false) // big-endian

  return result
}

/**
 * Create a fragment data payload.
 *
 * @param batchId - 8-byte batch ID
 * @param index - Zero-based fragment index
 * @param data - Fragment data chunk
 * @returns Fragment data transport payload
 */
export function createFragmentData(
  batchId: Uint8Array,
  index: number,
  data: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(1 + BATCH_ID_SIZE + 4 + data.length)
  const view = new DataView(result.buffer)

  result[0] = FRAGMENT_DATA
  result.set(batchId, 1)
  view.setUint32(1 + BATCH_ID_SIZE, index, false) // big-endian
  result.set(data, 1 + BATCH_ID_SIZE + 4)

  return result
}

/**
 * Parse a transport payload from raw bytes.
 *
 * @param data - Raw transport payload bytes
 * @returns Parsed TransportPayload
 * @throws FragmentParseError if parsing fails
 */
export function parseTransportPayload(data: Uint8Array): TransportPayload {
  if (data.length < 1) {
    throw new FragmentParseError("truncated_header", "Empty payload")
  }

  const prefix = data[0]

  switch (prefix) {
    case MESSAGE_COMPLETE: {
      // Complete message: prefix (1 byte) + message data
      return {
        kind: "message",
        data: data.slice(1),
      }
    }

    case FRAGMENT_HEADER: {
      // Fragment header: prefix (1) + batchId (8) + count (4) + totalSize (4) = 17 bytes
      if (data.length < 1 + FRAGMENT_HEADER_PAYLOAD_SIZE) {
        throw new FragmentParseError(
          "truncated_header",
          `Fragment header too short: expected ${1 + FRAGMENT_HEADER_PAYLOAD_SIZE} bytes, got ${data.length}`,
        )
      }

      const batchId = data.slice(1, 1 + BATCH_ID_SIZE)
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const count = view.getUint32(1 + BATCH_ID_SIZE, false)
      const totalSize = view.getUint32(1 + BATCH_ID_SIZE + 4, false)

      if (count === 0) {
        throw new FragmentParseError(
          "invalid_count",
          "Fragment count cannot be zero",
        )
      }

      return {
        kind: "fragment-header",
        batchId,
        count,
        totalSize,
      }
    }

    case FRAGMENT_DATA: {
      // Fragment data: prefix (1) + batchId (8) + index (4) + data (1+)
      if (data.length < 1 + FRAGMENT_DATA_MIN_SIZE) {
        throw new FragmentParseError(
          "truncated_data",
          `Fragment data too short: expected at least ${1 + FRAGMENT_DATA_MIN_SIZE} bytes, got ${data.length}`,
        )
      }

      const batchId = data.slice(1, 1 + BATCH_ID_SIZE)
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const index = view.getUint32(1 + BATCH_ID_SIZE, false)
      const fragmentData = data.slice(1 + BATCH_ID_SIZE + 4)

      return {
        kind: "fragment-data",
        batchId,
        index,
        data: fragmentData,
      }
    }

    default:
      throw new FragmentParseError(
        "unknown_prefix",
        `Unknown transport payload prefix: 0x${prefix.toString(16).padStart(2, "0")}`,
      )
  }
}

/**
 * Fragment a payload into multiple chunks.
 *
 * Returns an array of transport payloads:
 * - First element is always a fragment header
 * - Subsequent elements are fragment data chunks
 *
 * @param data - The payload to fragment
 * @param maxFragmentSize - Maximum size of each fragment's data (not including headers)
 * @returns Array of transport payloads (header + data chunks)
 */
export function fragmentPayload(
  data: Uint8Array,
  maxFragmentSize: number,
): Uint8Array[] {
  if (maxFragmentSize <= 0) {
    throw new Error("maxFragmentSize must be positive")
  }

  const batchId = generateBatchId()
  const fragmentCount = Math.ceil(data.length / maxFragmentSize)
  const result: Uint8Array[] = []

  // Create fragment header
  result.push(createFragmentHeader(batchId, fragmentCount, data.length))

  // Create fragment data chunks
  for (let i = 0; i < fragmentCount; i++) {
    const start = i * maxFragmentSize
    const end = Math.min(start + maxFragmentSize, data.length)
    const chunk = data.slice(start, end)
    result.push(createFragmentData(batchId, i, chunk))
  }

  return result
}

/**
 * Reassemble fragments into the original payload.
 *
 * This is a pure function that expects all fragments to be present.
 * Use FragmentReassembler for stateful reassembly with timeout handling.
 *
 * @param header - The fragment header
 * @param fragments - Map of fragment index to fragment data
 * @returns Reassembled payload
 * @throws FragmentReassembleError if reassembly fails
 */
export function reassembleFragments(
  header: TransportPayload & { kind: "fragment-header" },
  fragments: Map<number, Uint8Array>,
): Uint8Array {
  const { count, totalSize } = header

  // Verify all fragments are present
  if (fragments.size !== count) {
    const missing: number[] = []
    for (let i = 0; i < count; i++) {
      if (!fragments.has(i)) {
        missing.push(i)
      }
    }
    throw new FragmentReassembleError(
      "missing_fragments",
      `Missing ${count - fragments.size} fragments: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "..." : ""}`,
    )
  }

  // Validate indices
  for (const index of fragments.keys()) {
    if (index < 0 || index >= count) {
      throw new FragmentReassembleError(
        "invalid_index",
        `Invalid fragment index ${index} (expected 0-${count - 1})`,
      )
    }
  }

  // Calculate actual total size
  let actualSize = 0
  for (const data of fragments.values()) {
    actualSize += data.length
  }

  if (actualSize !== totalSize) {
    throw new FragmentReassembleError(
      "size_mismatch",
      `Size mismatch: expected ${totalSize} bytes, got ${actualSize} bytes`,
    )
  }

  // Reassemble in order
  const result = new Uint8Array(totalSize)
  let offset = 0

  for (let i = 0; i < count; i++) {
    // We already verified all fragments are present above
    const fragment = fragments.get(i) as Uint8Array
    result.set(fragment, offset)
    offset += fragment.length
  }

  return result
}

/**
 * Check if a payload should be fragmented based on size.
 *
 * @param payloadSize - Size of the payload in bytes
 * @param threshold - Size threshold for fragmentation
 * @returns true if the payload should be fragmented
 */
export function shouldFragment(
  payloadSize: number,
  threshold: number,
): boolean {
  return payloadSize > threshold
}

/**
 * Calculate the overhead of fragmentation for a given payload size.
 *
 * @param payloadSize - Size of the original payload
 * @param maxFragmentSize - Maximum size of each fragment
 * @returns Total overhead in bytes (headers + prefixes)
 */
export function calculateFragmentationOverhead(
  payloadSize: number,
  maxFragmentSize: number,
): number {
  const fragmentCount = Math.ceil(payloadSize / maxFragmentSize)
  // Header: 1 (prefix) + 8 (batchId) + 4 (count) + 4 (totalSize) = 17 bytes
  const headerOverhead = 1 + FRAGMENT_HEADER_PAYLOAD_SIZE
  // Per fragment: 1 (prefix) + 8 (batchId) + 4 (index) = 13 bytes
  const perFragmentOverhead = 1 + BATCH_ID_SIZE + 4
  return headerOverhead + fragmentCount * perFragmentOverhead
}
