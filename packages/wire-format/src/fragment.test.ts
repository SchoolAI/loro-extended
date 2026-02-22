/**
 * Tests for fragmentation pure functions and FragmentReassembler.
 *
 * Tests cover:
 * - Pure functions (fragmentPayload, parseTransportPayload, reassembleFragments)
 * - FragmentReassembler state management
 * - Concurrent batch handling
 * - Timeout cleanup
 * - Complete message during fragment reassembly
 * - Timer edge cases
 * - Memory limit enforcement
 * - End-to-end integration with wire format encoding
 */

import type { ChannelMsgSyncResponse } from "@loro-extended/repo"
import { LoroDoc } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import {
  BATCH_ID_SIZE,
  batchIdToKey,
  calculateFragmentationOverhead,
  createFragmentData,
  createFragmentHeader,
  FRAGMENT_DATA,
  FRAGMENT_HEADER,
  FragmentParseError,
  FragmentReassembleError,
  fragmentPayload,
  generateBatchId,
  keyToBatchId,
  MESSAGE_COMPLETE,
  parseTransportPayload,
  reassembleFragments,
  shouldFragment,
  type TransportPayload,
  wrapCompleteMessage,
} from "./fragment.js"
import { decodeFrame, encodeFrame } from "./index.js"
import { FragmentReassembler, type TimerAPI } from "./reassembler.js"

describe("Fragment Pure Functions", () => {
  describe("generateBatchId", () => {
    it("should generate 8-byte batch IDs", () => {
      const id = generateBatchId()
      expect(id).toBeInstanceOf(Uint8Array)
      expect(id.length).toBe(BATCH_ID_SIZE)
    })

    it("should generate unique batch IDs", () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(batchIdToKey(generateBatchId()))
      }
      expect(ids.size).toBe(100)
    })
  })

  describe("batchIdToKey / keyToBatchId", () => {
    it("should round-trip batch ID through hex encoding", () => {
      const original = generateBatchId()
      const key = batchIdToKey(original)
      const restored = keyToBatchId(key)

      expect(key).toHaveLength(16) // 8 bytes * 2 hex chars
      expect(restored).toEqual(original)
    })

    it("should handle all byte values", () => {
      const id = new Uint8Array([
        0x00, 0xff, 0x12, 0xab, 0xcd, 0xef, 0x01, 0x23,
      ])
      const key = batchIdToKey(id)
      expect(key).toBe("00ff12abcdef0123")

      const restored = keyToBatchId(key)
      expect(restored).toEqual(id)
    })
  })

  describe("wrapCompleteMessage", () => {
    it("should prefix data with MESSAGE_COMPLETE byte", () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const wrapped = wrapCompleteMessage(data)

      expect(wrapped[0]).toBe(MESSAGE_COMPLETE)
      expect(wrapped.slice(1)).toEqual(data)
      expect(wrapped.length).toBe(data.length + 1)
    })

    it("should handle empty data", () => {
      const data = new Uint8Array(0)
      const wrapped = wrapCompleteMessage(data)

      expect(wrapped.length).toBe(1)
      expect(wrapped[0]).toBe(MESSAGE_COMPLETE)
    })
  })

  describe("createFragmentHeader", () => {
    it("should create valid fragment header", () => {
      const batchId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const header = createFragmentHeader(batchId, 10, 50000)

      expect(header[0]).toBe(FRAGMENT_HEADER)
      expect(header.slice(1, 9)).toEqual(batchId)

      // Parse count (big-endian)
      const view = new DataView(header.buffer)
      expect(view.getUint32(9, false)).toBe(10)
      expect(view.getUint32(13, false)).toBe(50000)
    })
  })

  describe("createFragmentData", () => {
    it("should create valid fragment data", () => {
      const batchId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const data = new Uint8Array([10, 20, 30])
      const fragment = createFragmentData(batchId, 5, data)

      expect(fragment[0]).toBe(FRAGMENT_DATA)
      expect(fragment.slice(1, 9)).toEqual(batchId)

      // Parse index (big-endian)
      const view = new DataView(fragment.buffer)
      expect(view.getUint32(9, false)).toBe(5)

      // Check data
      expect(fragment.slice(13)).toEqual(data)
    })
  })

  describe("parseTransportPayload", () => {
    it("should parse complete message", () => {
      const data = new Uint8Array([1, 2, 3])
      const wrapped = wrapCompleteMessage(data)
      const parsed = parseTransportPayload(wrapped)

      expect(parsed.kind).toBe("message")
      if (parsed.kind === "message") {
        expect(parsed.data).toEqual(data)
      }
    })

    it("should parse fragment header", () => {
      const batchId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const header = createFragmentHeader(batchId, 10, 50000)
      const parsed = parseTransportPayload(header)

      expect(parsed.kind).toBe("fragment-header")
      if (parsed.kind === "fragment-header") {
        expect(parsed.batchId).toEqual(batchId)
        expect(parsed.count).toBe(10)
        expect(parsed.totalSize).toBe(50000)
      }
    })

    it("should parse fragment data", () => {
      const batchId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const data = new Uint8Array([10, 20, 30, 40])
      const fragment = createFragmentData(batchId, 3, data)
      const parsed = parseTransportPayload(fragment)

      expect(parsed.kind).toBe("fragment-data")
      if (parsed.kind === "fragment-data") {
        expect(parsed.batchId).toEqual(batchId)
        expect(parsed.index).toBe(3)
        expect(parsed.data).toEqual(data)
      }
    })

    it("should throw on empty payload", () => {
      expect(() => parseTransportPayload(new Uint8Array(0))).toThrow(
        FragmentParseError,
      )
    })

    it("should throw on unknown prefix", () => {
      const data = new Uint8Array([0x99, 1, 2, 3])
      expect(() => parseTransportPayload(data)).toThrow(FragmentParseError)
      try {
        parseTransportPayload(data)
      } catch (error) {
        expect((error as FragmentParseError).code).toBe("unknown_prefix")
      }
    })

    it("should throw on truncated fragment header", () => {
      // Only 10 bytes when 17 required
      const data = new Uint8Array([FRAGMENT_HEADER, 1, 2, 3, 4, 5, 6, 7, 8, 0])
      expect(() => parseTransportPayload(data)).toThrow(FragmentParseError)
      try {
        parseTransportPayload(data)
      } catch (error) {
        expect((error as FragmentParseError).code).toBe("truncated_header")
      }
    })

    it("should throw on fragment header with zero count", () => {
      const batchId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const header = createFragmentHeader(batchId, 0, 50000)
      // Manually fix the count to 0 (createFragmentHeader doesn't validate)
      expect(() => parseTransportPayload(header)).toThrow(FragmentParseError)
    })

    it("should throw on truncated fragment data", () => {
      // Only header prefix + batchId, no index or data
      const data = new Uint8Array([
        FRAGMENT_DATA,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        0,
        0,
        0,
        0,
      ])
      expect(() => parseTransportPayload(data)).toThrow(FragmentParseError)
    })
  })

  describe("fragmentPayload", () => {
    it("should fragment data into correct number of chunks", () => {
      const data = new Uint8Array(1000)
      const fragments = fragmentPayload(data, 300)

      // 1000 / 300 = 4 fragments (ceil)
      expect(fragments.length).toBe(5) // 1 header + 4 data fragments

      // First is header
      const header = parseTransportPayload(fragments[0])
      expect(header.kind).toBe("fragment-header")
      if (header.kind === "fragment-header") {
        expect(header.count).toBe(4)
        expect(header.totalSize).toBe(1000)
      }

      // Rest are data fragments
      for (let i = 1; i < fragments.length; i++) {
        const fragment = parseTransportPayload(fragments[i])
        expect(fragment.kind).toBe("fragment-data")
        if (fragment.kind === "fragment-data") {
          expect(fragment.index).toBe(i - 1)
        }
      }
    })

    it("should handle single fragment case", () => {
      const data = new Uint8Array(50)
      const fragments = fragmentPayload(data, 100)

      expect(fragments.length).toBe(2) // 1 header + 1 data
    })

    it("should handle exact size match", () => {
      const data = new Uint8Array(300)
      const fragments = fragmentPayload(data, 100)

      expect(fragments.length).toBe(4) // 1 header + 3 data (exact division)
    })

    it("should throw on non-positive maxFragmentSize", () => {
      expect(() => fragmentPayload(new Uint8Array(100), 0)).toThrow()
      expect(() => fragmentPayload(new Uint8Array(100), -1)).toThrow()
    })

    it("should use same batchId for all fragments", () => {
      const data = new Uint8Array(500)
      const fragments = fragmentPayload(data, 100)

      const header = parseTransportPayload(fragments[0])
      expect(header.kind).toBe("fragment-header")

      const batchId =
        header.kind === "fragment-header" ? header.batchId : undefined

      for (let i = 1; i < fragments.length; i++) {
        const fragment = parseTransportPayload(fragments[i])
        expect(fragment.kind).toBe("fragment-data")
        if (fragment.kind === "fragment-data") {
          expect(fragment.batchId).toEqual(batchId)
        }
      }
    })
  })

  describe("reassembleFragments", () => {
    it("should reassemble fragments in order", () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      const fragments = fragmentPayload(original, 3)

      // Parse header
      const header = parseTransportPayload(fragments[0]) as TransportPayload & {
        kind: "fragment-header"
      }

      // Collect fragment data
      const fragmentMap = new Map<number, Uint8Array>()
      for (let i = 1; i < fragments.length; i++) {
        const fragment = parseTransportPayload(fragments[i])
        if (fragment.kind === "fragment-data") {
          fragmentMap.set(fragment.index, fragment.data)
        }
      }

      const reassembled = reassembleFragments(header, fragmentMap)
      expect(reassembled).toEqual(original)
    })

    it("should throw on missing fragments", () => {
      const header: TransportPayload & { kind: "fragment-header" } = {
        kind: "fragment-header",
        batchId: new Uint8Array(8),
        count: 5,
        totalSize: 500,
      }

      const fragmentMap = new Map<number, Uint8Array>()
      fragmentMap.set(0, new Uint8Array(100))
      fragmentMap.set(2, new Uint8Array(100))
      // Missing 1, 3, 4

      expect(() => reassembleFragments(header, fragmentMap)).toThrow(
        FragmentReassembleError,
      )
      try {
        reassembleFragments(header, fragmentMap)
      } catch (error) {
        expect((error as FragmentReassembleError).code).toBe(
          "missing_fragments",
        )
      }
    })

    it("should throw on invalid index", () => {
      const header: TransportPayload & { kind: "fragment-header" } = {
        kind: "fragment-header",
        batchId: new Uint8Array(8),
        count: 2,
        totalSize: 200,
      }

      const fragmentMap = new Map<number, Uint8Array>()
      fragmentMap.set(0, new Uint8Array(100))
      fragmentMap.set(5, new Uint8Array(100)) // Invalid index

      expect(() => reassembleFragments(header, fragmentMap)).toThrow(
        FragmentReassembleError,
      )
    })

    it("should throw on size mismatch", () => {
      const header: TransportPayload & { kind: "fragment-header" } = {
        kind: "fragment-header",
        batchId: new Uint8Array(8),
        count: 2,
        totalSize: 200,
      }

      const fragmentMap = new Map<number, Uint8Array>()
      fragmentMap.set(0, new Uint8Array(100))
      fragmentMap.set(1, new Uint8Array(50)) // Total = 150, expected 200

      expect(() => reassembleFragments(header, fragmentMap)).toThrow(
        FragmentReassembleError,
      )
      try {
        reassembleFragments(header, fragmentMap)
      } catch (error) {
        expect((error as FragmentReassembleError).code).toBe("size_mismatch")
      }
    })
  })

  describe("shouldFragment", () => {
    it("should return true when payload exceeds threshold", () => {
      expect(shouldFragment(1000, 500)).toBe(true)
    })

    it("should return false when payload is under threshold", () => {
      expect(shouldFragment(400, 500)).toBe(false)
    })

    it("should return false when payload equals threshold", () => {
      expect(shouldFragment(500, 500)).toBe(false)
    })
  })

  describe("calculateFragmentationOverhead", () => {
    it("should calculate correct overhead", () => {
      // 1000 bytes / 300 = 4 fragments
      // Header: 17 bytes
      // Per fragment: 13 bytes * 4 = 52 bytes
      // Total: 69 bytes
      const overhead = calculateFragmentationOverhead(1000, 300)
      expect(overhead).toBe(17 + 13 * 4)
    })

    it("should handle single fragment", () => {
      const overhead = calculateFragmentationOverhead(50, 100)
      expect(overhead).toBe(17 + 13) // Header + 1 fragment
    })
  })
})

describe("FragmentReassembler", () => {
  /**
   * Create a mock timer API for testing.
   */
  function createMockTimer(): {
    timer: TimerAPI
    pending: Map<unknown, { fn: () => void; ms: number }>
    nextId: number
    advance: (ms: number) => void
    triggerAll: () => void
  } {
    const pending = new Map<unknown, { fn: () => void; ms: number }>()
    let nextId = 1

    return {
      timer: {
        setTimeout: (fn: () => void, ms: number) => {
          const id = nextId++
          pending.set(id, { fn, ms })
          return id
        },
        clearTimeout: (id: unknown) => {
          pending.delete(id)
        },
      },
      pending,
      nextId: 0,
      advance: (ms: number) => {
        for (const [id, { fn, ms: timeout }] of pending) {
          if (timeout <= ms) {
            pending.delete(id)
            fn()
          }
        }
      },
      triggerAll: () => {
        const callbacks = Array.from(pending.values())
        pending.clear()
        for (const { fn } of callbacks) {
          fn()
        }
      },
    }
  }

  describe("complete message pass-through", () => {
    it("should return complete message immediately", () => {
      const reassembler = new FragmentReassembler()
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const wrapped = wrapCompleteMessage(data)
      const payload = parseTransportPayload(wrapped)

      const result = reassembler.receive(payload)

      expect(result.status).toBe("complete")
      if (result.status === "complete") {
        expect(result.data).toEqual(data)
      }

      reassembler.dispose()
    })

    it("should handle receiveRaw for complete messages", () => {
      const reassembler = new FragmentReassembler()
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const wrapped = wrapCompleteMessage(data)

      const result = reassembler.receiveRaw(wrapped)

      expect(result.status).toBe("complete")
      if (result.status === "complete") {
        expect(result.data).toEqual(data)
      }

      reassembler.dispose()
    })
  })

  describe("fragment reassembly", () => {
    it("should reassemble fragments in order", () => {
      const reassembler = new FragmentReassembler()
      const original = new Uint8Array(100)
      for (let i = 0; i < 100; i++) original[i] = i

      const fragments = fragmentPayload(original, 30)

      // Send all fragments
      let finalResult: ReturnType<typeof reassembler.receiveRaw> | undefined
      for (const fragment of fragments) {
        const result = reassembler.receiveRaw(fragment)
        if (result.status === "complete") {
          finalResult = result
        }
      }

      expect(finalResult).toBeDefined()
      expect(finalResult?.status).toBe("complete")
      if (finalResult?.status === "complete") {
        expect(finalResult.data).toEqual(original)
      }

      reassembler.dispose()
    })

    it("should reassemble fragments out of order", () => {
      const reassembler = new FragmentReassembler()
      const original = new Uint8Array(100)
      for (let i = 0; i < 100; i++) original[i] = i

      const fragments = fragmentPayload(original, 30)

      // Send header first
      reassembler.receiveRaw(fragments[0])

      // Send data fragments in reverse order
      reassembler.receiveRaw(fragments[4]) // index 3
      reassembler.receiveRaw(fragments[2]) // index 1
      reassembler.receiveRaw(fragments[3]) // index 2
      const result = reassembler.receiveRaw(fragments[1]) // index 0 (completes)

      expect(result.status).toBe("complete")
      if (result.status === "complete") {
        expect(result.data).toEqual(original)
      }

      reassembler.dispose()
    })

    it("should return pending while incomplete", () => {
      const reassembler = new FragmentReassembler()
      const original = new Uint8Array(100)
      const fragments = fragmentPayload(original, 30)

      // Send header only
      const result = reassembler.receiveRaw(fragments[0])
      expect(result.status).toBe("pending")

      // Send partial fragments
      const result2 = reassembler.receiveRaw(fragments[1])
      expect(result2.status).toBe("pending")

      expect(reassembler.pendingBatchCount).toBe(1)

      reassembler.dispose()
    })
  })

  describe("concurrent batches", () => {
    it("should handle multiple concurrent batches", () => {
      const reassembler = new FragmentReassembler()

      const data1 = new Uint8Array([1, 2, 3, 4, 5])
      const data2 = new Uint8Array([10, 20, 30, 40, 50])

      const fragments1 = fragmentPayload(data1, 2)
      const fragments2 = fragmentPayload(data2, 2)

      // Interleave fragments
      reassembler.receiveRaw(fragments1[0]) // header 1
      reassembler.receiveRaw(fragments2[0]) // header 2
      expect(reassembler.pendingBatchCount).toBe(2)

      reassembler.receiveRaw(fragments1[1]) // data 1.0
      reassembler.receiveRaw(fragments2[1]) // data 2.0
      reassembler.receiveRaw(fragments1[2]) // data 1.1
      reassembler.receiveRaw(fragments2[2]) // data 2.1

      // Complete batch 1
      const result1 = reassembler.receiveRaw(fragments1[3])
      expect(result1.status).toBe("complete")
      if (result1.status === "complete") {
        expect(result1.data).toEqual(data1)
      }

      // Complete batch 2
      const result2 = reassembler.receiveRaw(fragments2[3])
      expect(result2.status).toBe("complete")
      if (result2.status === "complete") {
        expect(result2.data).toEqual(data2)
      }

      reassembler.dispose()
    })
  })

  describe("error handling", () => {
    it("should return error on duplicate fragment", () => {
      const reassembler = new FragmentReassembler()
      const data = new Uint8Array(100)
      const fragments = fragmentPayload(data, 30)

      reassembler.receiveRaw(fragments[0]) // header
      reassembler.receiveRaw(fragments[1]) // index 0

      // Send duplicate
      const result = reassembler.receiveRaw(fragments[1])

      expect(result.status).toBe("error")
      if (result.status === "error") {
        expect(result.error.type).toBe("duplicate_fragment")
      }

      reassembler.dispose()
    })

    it("should return error on invalid index", () => {
      const reassembler = new FragmentReassembler()
      const batchId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

      // Send header with count=2
      const header = createFragmentHeader(batchId, 2, 100)
      reassembler.receiveRaw(header)

      // Send fragment with index=5 (invalid)
      const fragment = createFragmentData(batchId, 5, new Uint8Array(50))
      const result = reassembler.receiveRaw(fragment)

      expect(result.status).toBe("error")
      if (result.status === "error") {
        expect(result.error.type).toBe("invalid_index")
      }

      reassembler.dispose()
    })

    it("should return error on parse failure", () => {
      const reassembler = new FragmentReassembler()
      const invalid = new Uint8Array([0x99, 1, 2, 3]) // Unknown prefix

      const result = reassembler.receiveRaw(invalid)

      expect(result.status).toBe("error")
      if (result.status === "error") {
        expect(result.error.type).toBe("parse_error")
      }

      reassembler.dispose()
    })

    it("should ignore fragment data without header", () => {
      const reassembler = new FragmentReassembler()
      const batchId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const fragment = createFragmentData(batchId, 0, new Uint8Array(50))

      const result = reassembler.receiveRaw(fragment)

      // Should return pending, not error (fragment is orphaned)
      expect(result.status).toBe("pending")
      expect(reassembler.pendingBatchCount).toBe(0)

      reassembler.dispose()
    })
  })

  describe("timeout handling", () => {
    it("should call onTimeout callback after timeout", () => {
      const mockTimer = createMockTimer()
      const onTimeout = vi.fn()

      const reassembler = new FragmentReassembler(
        { timeoutMs: 1000, onTimeout },
        mockTimer.timer,
      )

      const data = new Uint8Array(100)
      const fragments = fragmentPayload(data, 30)

      // Start batch
      reassembler.receiveRaw(fragments[0])
      expect(reassembler.pendingBatchCount).toBe(1)

      // Trigger timeout
      mockTimer.triggerAll()

      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(reassembler.pendingBatchCount).toBe(0)

      reassembler.dispose()
    })

    it("should clear timer on successful completion", () => {
      const mockTimer = createMockTimer()
      const onTimeout = vi.fn()

      const reassembler = new FragmentReassembler(
        { timeoutMs: 1000, onTimeout },
        mockTimer.timer,
      )

      const data = new Uint8Array(50)
      const fragments = fragmentPayload(data, 30)

      // Complete batch before timeout
      for (const fragment of fragments) {
        reassembler.receiveRaw(fragment)
      }

      expect(mockTimer.pending.size).toBe(0)
      expect(onTimeout).not.toHaveBeenCalled()

      reassembler.dispose()
    })
  })

  describe("memory limit enforcement", () => {
    it("should evict oldest batch when memory limit exceeded", () => {
      const onEvicted = vi.fn()

      const reassembler = new FragmentReassembler({
        maxTotalReassemblyBytes: 80, // Very low limit - less than 2 fragments worth
        onEvicted,
      })

      const data1 = new Uint8Array(100)
      const data2 = new Uint8Array(100)

      const fragments1 = fragmentPayload(data1, 50)
      const fragments2 = fragmentPayload(data2, 50)

      // Start batch 1
      reassembler.receiveRaw(fragments1[0]) // header only, 0 bytes tracked
      reassembler.receiveRaw(fragments1[1]) // 50 bytes tracked

      // Start batch 2
      reassembler.receiveRaw(fragments2[0]) // header only
      reassembler.receiveRaw(fragments2[1]) // 50 bytes, total 100 - exceeds 80 limit

      // At 100 bytes with 80 limit, batch 1 should be evicted
      expect(onEvicted).toHaveBeenCalled()
      expect(reassembler.pendingBatchCount).toBe(1)

      reassembler.dispose()
    })

    it("should enforce maxConcurrentBatches", () => {
      const onEvicted = vi.fn()

      const reassembler = new FragmentReassembler({
        maxConcurrentBatches: 2,
        onEvicted,
      })

      // Create 3 batches
      for (let i = 0; i < 3; i++) {
        const data = new Uint8Array(50)
        const fragments = fragmentPayload(data, 25)
        reassembler.receiveRaw(fragments[0]) // Send headers only
      }

      // Third batch should evict first
      expect(onEvicted).toHaveBeenCalledTimes(1)
      expect(reassembler.pendingBatchCount).toBe(2)

      reassembler.dispose()
    })
  })

  describe("complete message during reassembly", () => {
    it("should handle complete message while fragments pending", () => {
      const reassembler = new FragmentReassembler()

      // Start a fragmented batch
      const fragData = new Uint8Array(100)
      const fragments = fragmentPayload(fragData, 30)
      reassembler.receiveRaw(fragments[0]) // header
      reassembler.receiveRaw(fragments[1]) // partial

      expect(reassembler.pendingBatchCount).toBe(1)

      // Receive a complete message mid-reassembly
      const completeData = new Uint8Array([42, 43, 44])
      const wrapped = wrapCompleteMessage(completeData)
      const result = reassembler.receiveRaw(wrapped)

      // Complete message should be returned immediately
      expect(result.status).toBe("complete")
      if (result.status === "complete") {
        expect(result.data).toEqual(completeData)
      }

      // Fragment batch should still be pending
      expect(reassembler.pendingBatchCount).toBe(1)

      reassembler.dispose()
    })
  })

  describe("dispose", () => {
    it("should clear all pending timers on dispose", () => {
      const mockTimer = createMockTimer()

      const reassembler = new FragmentReassembler(
        { timeoutMs: 1000 },
        mockTimer.timer,
      )

      // Start multiple batches
      for (let i = 0; i < 5; i++) {
        const data = new Uint8Array(50)
        const fragments = fragmentPayload(data, 25)
        reassembler.receiveRaw(fragments[0])
      }

      expect(mockTimer.pending.size).toBe(5)

      reassembler.dispose()

      expect(mockTimer.pending.size).toBe(0)
      expect(reassembler.pendingBatchCount).toBe(0)
    })

    it("should return error after dispose", () => {
      const reassembler = new FragmentReassembler()
      reassembler.dispose()

      const data = new Uint8Array([1, 2, 3])
      const wrapped = wrapCompleteMessage(data)
      const result = reassembler.receiveRaw(wrapped)

      expect(result.status).toBe("error")
      if (result.status === "error") {
        expect(result.error.type).toBe("parse_error")
      }
    })

    it("should be idempotent", () => {
      const reassembler = new FragmentReassembler()
      reassembler.dispose()
      reassembler.dispose() // Should not throw
    })
  })

  describe("pendingBytes tracking", () => {
    it("should track received bytes accurately", () => {
      const reassembler = new FragmentReassembler()

      const data = new Uint8Array(100)
      const fragments = fragmentPayload(data, 30)

      reassembler.receiveRaw(fragments[0]) // header
      expect(reassembler.pendingBytes).toBe(0)

      reassembler.receiveRaw(fragments[1]) // 30 bytes
      expect(reassembler.pendingBytes).toBe(30)

      reassembler.receiveRaw(fragments[2]) // 30 bytes
      expect(reassembler.pendingBytes).toBe(60)

      // Complete the batch
      reassembler.receiveRaw(fragments[3])
      reassembler.receiveRaw(fragments[4])

      // After completion, bytes should be reclaimed
      expect(reassembler.pendingBytes).toBe(0)

      reassembler.dispose()
    })
  })
})

describe("End-to-end Integration: Wire Format + Fragmentation", () => {
  it("should encode, fragment, reassemble, and decode a large ChannelMsg", () => {
    // 1. Create a large payload (>64KB to test the regression fix)
    // Use raw bytes instead of Loro snapshot since CRDT compression is very efficient
    const largeData = new Uint8Array(100 * 1024) // 100KB
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256
    }

    const doc = new LoroDoc()
    doc.getText("content").insert(0, "test")
    doc.commit()

    const msg: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "large-doc-integration-test",
      transmission: {
        type: "snapshot",
        data: largeData,
        version: doc.version(),
      },
    }

    // 2. Encode to wire format frame
    const frame = encodeFrame(msg)

    // 3. Fragment the frame (simulate 16KB transport limit)
    const fragments = fragmentPayload(frame, 16 * 1024)
    expect(fragments.length).toBeGreaterThan(2) // Should be multiple fragments

    // 4. Reassemble (simulate receiving fragments)
    const reassembler = new FragmentReassembler()
    let reassembledFrame: Uint8Array | undefined

    for (const fragment of fragments) {
      const result = reassembler.receiveRaw(fragment)
      if (result.status === "complete") {
        reassembledFrame = result.data
      }
    }

    expect(reassembledFrame).toBeDefined()

    // 5. Decode back to ChannelMsg
    const decoded = decodeFrame(reassembledFrame as Uint8Array)
    expect(decoded).toHaveLength(1)

    const result = decoded[0] as ChannelMsgSyncResponse
    expect(result.type).toBe("channel/sync-response")
    expect(result.docId).toBe("large-doc-integration-test")
    expect(result.transmission.type).toBe("snapshot")

    if (result.transmission.type === "snapshot") {
      // Verify the large data survived the round-trip
      expect(result.transmission.data.length).toBe(largeData.length)
      expect(result.transmission.data).toEqual(largeData)
    }

    reassembler.dispose()
  })

  it("should handle interleaved complete messages and fragments", () => {
    const reassembler = new FragmentReassembler()

    // Start a fragmented transfer
    const largeData = new Uint8Array(1000)
    for (let i = 0; i < largeData.length; i++) largeData[i] = i % 256
    const fragments = fragmentPayload(largeData, 300)

    // Send header and first fragment
    reassembler.receiveRaw(fragments[0])
    reassembler.receiveRaw(fragments[1])

    // Interleave a complete (non-fragmented) message
    const smallMsg: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "small-interleaved",
      transmission: { type: "unavailable" },
    }
    const smallFrame = encodeFrame(smallMsg)
    const wrappedSmall = wrapCompleteMessage(smallFrame)

    const smallResult = reassembler.receiveRaw(wrappedSmall)
    expect(smallResult.status).toBe("complete")
    if (smallResult.status === "complete") {
      const decoded = decodeFrame(smallResult.data)
      expect(decoded[0].type).toBe("channel/sync-response")
    }

    // Continue with remaining fragments
    let largeResult: ReturnType<typeof reassembler.receiveRaw> | undefined
    for (let i = 2; i < fragments.length; i++) {
      const result = reassembler.receiveRaw(fragments[i])
      if (result.status === "complete") {
        largeResult = result
      }
    }

    expect(largeResult?.status).toBe("complete")
    if (largeResult?.status === "complete") {
      expect(largeResult.data).toEqual(largeData)
    }

    reassembler.dispose()
  })
})
