/**
 * Error types for wire format decoding.
 */

/**
 * Error codes for decode failures.
 */
export type DecodeErrorCode =
  | "invalid_cbor"
  | "unsupported_version"
  | "truncated_frame"
  | "missing_field"
  | "invalid_type"

/**
 * Error thrown when decoding a wire format message fails.
 */
export class DecodeError extends Error {
  override readonly name = "DecodeError"

  constructor(
    public readonly code: DecodeErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DecodeError)
    }
  }
}
