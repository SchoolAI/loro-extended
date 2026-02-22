/**
 * Framework-agnostic HTTP polling POST handler (Functional Core).
 *
 * This module provides pure functions for handling binary POST requests
 * in HTTP polling adapters. Framework-specific adapters (Express, Hono, etc.)
 * use these functions and handle the HTTP-specific concerns.
 *
 * Design: Functional Core / Imperative Shell
 * - This module parses and decodes, returning a result describing what to do
 * - Framework adapters execute side effects (delivering messages, sending responses)
 */

import type { ChannelMsg } from "@loro-extended/repo"
import {
  decodeFrame,
  type FragmentReassembler,
} from "@loro-extended/wire-format"

/**
 * Response to send back to the client after processing a POST.
 */
export interface PollingPostResponse {
  status: 200 | 202 | 400
  body: { ok: true } | { pending: true } | { error: string }
}

/**
 * Result of parsing a binary POST body.
 *
 * Discriminated union describing what happened:
 * - "messages": Complete message(s) decoded, ready to deliver
 * - "pending": Fragment received, waiting for more
 * - "error": Decode/reassembly error
 */
export type PollingPostResult =
  | { type: "messages"; messages: ChannelMsg[]; response: PollingPostResponse }
  | { type: "pending"; response: PollingPostResponse }
  | { type: "error"; response: PollingPostResponse }

/**
 * Parse a binary POST body through the reassembler.
 *
 * This is the functional core of POST handling. It:
 * 1. Passes the body through the reassembler (handles fragmentation)
 * 2. If complete, decodes the CBOR frame to ChannelMsg(s)
 * 3. Returns a result describing what happened
 *
 * The caller (framework adapter) executes side effects based on the result.
 *
 * @param reassembler - The connection's fragment reassembler
 * @param body - Raw binary POST body (with transport layer prefix)
 * @returns Result describing what to do
 *
 * @example
 * ```typescript
 * // In Express router (imperative shell)
 * const result = parsePostBody(connection.reassembler, req.body)
 *
 * if (result.type === "messages") {
 *   for (const msg of result.messages) {
 *     connection.receive(msg)
 *   }
 * }
 *
 * res.status(result.response.status).json(result.response.body)
 * ```
 */
export function parsePostBody(
  reassembler: FragmentReassembler,
  body: Uint8Array,
): PollingPostResult {
  const result = reassembler.receiveRaw(body)

  if (result.status === "complete") {
    try {
      const messages = decodeFrame(result.data)
      return {
        type: "messages",
        messages,
        response: { status: 200, body: { ok: true } },
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "decode_failed"
      return {
        type: "error",
        response: { status: 400, body: { error: errorMessage } },
      }
    }
  } else if (result.status === "pending") {
    return {
      type: "pending",
      response: { status: 202, body: { pending: true } },
    }
  } else {
    // result.status === "error"
    return {
      type: "error",
      response: { status: 400, body: { error: result.error.type } },
    }
  }
}
