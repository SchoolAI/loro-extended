/**
 * Stateful fragment reassembly.
 *
 * This module provides the imperative shell for fragment reassembly,
 * managing batch state and timers. Pure reassembly logic is in `fragment.ts`.
 *
 * Design: Functional Core / Imperative Shell
 * - FragmentReassembler manages stateful concerns (timers, batch tracking)
 * - Delegates to pure functions for data transformation
 */

import {
  batchIdToKey,
  type FragmentReassembleError,
  parseTransportPayload,
  reassembleFragments,
  type TransportPayload,
} from "./fragment.js"

/**
 * Result of processing a transport payload.
 */
export type ReassembleResult =
  | { status: "complete"; data: Uint8Array }
  | { status: "pending" }
  | { status: "error"; error: ReassembleError }

/**
 * Errors that can occur during reassembly.
 */
export type ReassembleError =
  | { type: "duplicate_fragment"; batchId: Uint8Array; index: number }
  | { type: "invalid_index"; batchId: Uint8Array; index: number; max: number }
  | { type: "timeout"; batchId: Uint8Array }
  | { type: "size_mismatch"; expected: number; actual: number }
  | { type: "evicted"; batchId: Uint8Array }
  | { type: "parse_error"; message: string }
  | { type: "reassemble_error"; message: string }

/**
 * Configuration for the fragment reassembler.
 */
export interface ReassemblerConfig {
  /** Timeout in milliseconds before abandoning a batch (default: 10000) */
  timeoutMs: number
  /** Maximum number of concurrent batches to track (default: 32) */
  maxConcurrentBatches: number
  /** Maximum total bytes across all batches (default: 50MB) */
  maxTotalReassemblyBytes: number
  /** Callback when a batch times out */
  onTimeout?: (batchId: Uint8Array) => void
  /** Callback when a batch is evicted due to memory pressure */
  onEvicted?: (batchId: Uint8Array) => void
}

/**
 * Timer API for dependency injection (enables testing).
 */
export interface TimerAPI {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}

/**
 * Internal state for an in-flight batch.
 */
interface BatchState {
  batchId: Uint8Array
  expectedCount: number
  totalSize: number
  receivedFragments: Map<number, Uint8Array>
  receivedBytes: number
  startedAt: number
  timerId: unknown
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: ReassemblerConfig = {
  timeoutMs: 10000,
  maxConcurrentBatches: 32,
  maxTotalReassemblyBytes: 50 * 1024 * 1024, // 50MB
}

/**
 * Default timer API using global setTimeout/clearTimeout.
 */
const DEFAULT_TIMER_API: TimerAPI = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
}

/**
 * Stateful fragment reassembler.
 *
 * Responsibilities:
 * - Track in-flight batches via Map<string, BatchState>
 * - Manage timeout timers per batch
 * - Enforce memory limits (evict oldest batch when exceeded)
 *
 * Delegates to pure functions:
 * - parseTransportPayload() for parsing
 * - reassembleFragments() when all fragments received
 * - batchIdToKey() for Map key conversion
 */
export class FragmentReassembler {
  private readonly config: ReassemblerConfig
  private readonly timer: TimerAPI
  private readonly batches = new Map<string, BatchState>()
  private totalBytes = 0
  private disposed = false

  constructor(config?: Partial<ReassemblerConfig>, timer?: TimerAPI) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.timer = timer ?? DEFAULT_TIMER_API
  }

  /**
   * Process an incoming transport payload.
   *
   * @param payload - Parsed transport payload
   * @returns Result indicating complete, pending, or error
   */
  receive(payload: TransportPayload): ReassembleResult {
    if (this.disposed) {
      return {
        status: "error",
        error: {
          type: "parse_error",
          message: "Reassembler has been disposed",
        },
      }
    }

    switch (payload.kind) {
      case "message":
        // Complete message - pass through immediately
        return { status: "complete", data: payload.data }

      case "fragment-header":
        return this.handleFragmentHeader(payload)

      case "fragment-data":
        return this.handleFragmentData(payload)
    }
  }

  /**
   * Process raw bytes as a transport payload.
   *
   * @param data - Raw transport payload bytes
   * @returns Result indicating complete, pending, or error
   */
  receiveRaw(data: Uint8Array): ReassembleResult {
    try {
      const payload = parseTransportPayload(data)
      return this.receive(payload)
    } catch (error) {
      return {
        status: "error",
        error: {
          type: "parse_error",
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /**
   * Clean up all resources.
   * Cancels all pending timers and clears batch state.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    for (const batch of this.batches.values()) {
      if (batch.timerId !== undefined) {
        this.timer.clearTimeout(batch.timerId)
      }
    }
    this.batches.clear()
    this.totalBytes = 0
  }

  /**
   * Get the number of in-flight batches.
   */
  get pendingBatchCount(): number {
    return this.batches.size
  }

  /**
   * Get the total bytes currently being tracked.
   */
  get pendingBytes(): number {
    return this.totalBytes
  }

  /**
   * Handle a fragment header.
   */
  private handleFragmentHeader(
    header: TransportPayload & { kind: "fragment-header" },
  ): ReassembleResult {
    const key = batchIdToKey(header.batchId)

    // Check if batch already exists (duplicate header)
    if (this.batches.has(key)) {
      // Ignore duplicate headers - the batch is already in progress
      return { status: "pending" }
    }

    // Enforce max concurrent batches
    if (this.batches.size >= this.config.maxConcurrentBatches) {
      this.evictOldestBatch()
    }

    // Create new batch state
    const batch: BatchState = {
      batchId: header.batchId,
      expectedCount: header.count,
      totalSize: header.totalSize,
      receivedFragments: new Map(),
      receivedBytes: 0,
      startedAt: Date.now(),
      timerId: undefined,
    }

    // Set up timeout timer
    batch.timerId = this.timer.setTimeout(() => {
      this.handleTimeout(key)
    }, this.config.timeoutMs)

    this.batches.set(key, batch)
    return { status: "pending" }
  }

  /**
   * Handle fragment data.
   */
  private handleFragmentData(
    fragment: TransportPayload & { kind: "fragment-data" },
  ): ReassembleResult {
    const key = batchIdToKey(fragment.batchId)
    const batch = this.batches.get(key)

    if (!batch) {
      // Fragment arrived before or without header - ignore
      // This can happen during reconnection or if header was lost
      return { status: "pending" }
    }

    // Validate index
    if (fragment.index < 0 || fragment.index >= batch.expectedCount) {
      return {
        status: "error",
        error: {
          type: "invalid_index",
          batchId: fragment.batchId,
          index: fragment.index,
          max: batch.expectedCount - 1,
        },
      }
    }

    // Check for duplicate
    if (batch.receivedFragments.has(fragment.index)) {
      return {
        status: "error",
        error: {
          type: "duplicate_fragment",
          batchId: fragment.batchId,
          index: fragment.index,
        },
      }
    }

    // Add fragment
    batch.receivedFragments.set(fragment.index, fragment.data)
    batch.receivedBytes += fragment.data.length
    this.totalBytes += fragment.data.length

    // Enforce memory limit
    while (this.totalBytes > this.config.maxTotalReassemblyBytes) {
      const evicted = this.evictOldestBatch()
      if (!evicted) break // No more batches to evict

      // If we evicted the current batch, return error
      if (!this.batches.has(key)) {
        return {
          status: "error",
          error: { type: "evicted", batchId: fragment.batchId },
        }
      }
    }

    // Check if batch is complete
    if (batch.receivedFragments.size === batch.expectedCount) {
      return this.completeBatch(key, batch)
    }

    return { status: "pending" }
  }

  /**
   * Complete a batch by reassembling all fragments.
   */
  private completeBatch(key: string, batch: BatchState): ReassembleResult {
    // Cancel timeout timer
    if (batch.timerId !== undefined) {
      this.timer.clearTimeout(batch.timerId)
    }

    // Remove from tracking
    this.batches.delete(key)
    this.totalBytes -= batch.receivedBytes

    // Reassemble using pure function
    try {
      const header: TransportPayload & { kind: "fragment-header" } = {
        kind: "fragment-header",
        batchId: batch.batchId,
        count: batch.expectedCount,
        totalSize: batch.totalSize,
      }
      const data = reassembleFragments(header, batch.receivedFragments)
      return { status: "complete", data }
    } catch (error) {
      const reassembleError = error as FragmentReassembleError
      if (reassembleError.code === "size_mismatch") {
        return {
          status: "error",
          error: {
            type: "size_mismatch",
            expected: batch.totalSize,
            actual: batch.receivedBytes,
          },
        }
      }
      return {
        status: "error",
        error: {
          type: "reassemble_error",
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /**
   * Handle batch timeout.
   */
  private handleTimeout(key: string): void {
    const batch = this.batches.get(key)
    if (!batch) return

    // Clean up batch
    this.batches.delete(key)
    this.totalBytes -= batch.receivedBytes

    // Notify via callback
    this.config.onTimeout?.(batch.batchId)
  }

  /**
   * Evict the oldest batch to free memory.
   * @returns true if a batch was evicted
   */
  private evictOldestBatch(): boolean {
    // Find oldest batch by startedAt
    let oldest: { key: string; batch: BatchState } | undefined
    for (const [key, batch] of this.batches) {
      if (!oldest || batch.startedAt < oldest.batch.startedAt) {
        oldest = { key, batch }
      }
    }

    if (!oldest) return false

    // Cancel timeout timer
    if (oldest.batch.timerId !== undefined) {
      this.timer.clearTimeout(oldest.batch.timerId)
    }

    // Remove batch
    this.batches.delete(oldest.key)
    this.totalBytes -= oldest.batch.receivedBytes

    // Notify via callback
    this.config.onEvicted?.(oldest.batch.batchId)

    return true
  }
}
