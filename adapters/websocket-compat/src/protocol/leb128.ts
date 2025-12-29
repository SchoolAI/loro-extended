/**
 * LEB128 (Little Endian Base 128) encoding/decoding utilities.
 * Used for variable-length integer encoding in the Loro Syncing Protocol.
 */

/**
 * Encode an unsigned integer as LEB128.
 * @param value The unsigned integer to encode (must be non-negative)
 * @returns Uint8Array containing the LEB128 encoded bytes
 */
export function encodeULEB128(value: number): Uint8Array {
  if (value < 0) {
    throw new Error("encodeULEB128: value must be non-negative")
  }

  const bytes: number[] = []

  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) {
      byte |= 0x80 // Set high bit to indicate more bytes follow
    }
    bytes.push(byte)
  } while (value !== 0)

  return new Uint8Array(bytes)
}

/**
 * Decode an unsigned LEB128 integer from a buffer.
 * @param data The buffer containing LEB128 encoded data
 * @param offset The offset to start reading from
 * @returns A tuple of [decoded value, new offset after reading]
 */
export function decodeULEB128(
  data: Uint8Array,
  offset: number,
): [number, number] {
  let result = 0
  let shift = 0
  let currentOffset = offset

  while (true) {
    if (currentOffset >= data.length) {
      throw new Error("decodeULEB128: unexpected end of data")
    }

    const byte = data[currentOffset]
    currentOffset++

    result |= (byte & 0x7f) << shift

    if ((byte & 0x80) === 0) {
      break
    }

    shift += 7

    // Prevent overflow for JavaScript numbers (safe up to 53 bits)
    if (shift > 49) {
      throw new Error("decodeULEB128: integer too large")
    }
  }

  return [result, currentOffset]
}

/**
 * Calculate the number of bytes needed to encode a value as ULEB128.
 * @param value The value to calculate size for
 * @returns Number of bytes needed
 */
export function uleb128Size(value: number): number {
  if (value < 0) {
    throw new Error("uleb128Size: value must be non-negative")
  }

  let size = 0
  do {
    size++
    value >>>= 7
  } while (value !== 0)

  return size
}
