/** biome-ignore-all lint/style/noNonNullAssertion: fine for testing */
import type { PeerID } from "@loro-extended/repo"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { SignalData } from "../../shared/types"
import { useSignalChannel } from "./use-signal-channel"

describe("useSignalChannel", () => {
  const peerA = "100000000000000000000000000000" as PeerID
  const peerB = "200000000000000000000000000000" as PeerID
  const testInstanceId = "test-instance-id"

  describe("queueOutgoingSignal", () => {
    it("adds signal to outgoing signals for target peer", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      act(() => {
        result.current.queueOutgoingSignal(peerA, {
          type: "offer",
          sdp: "test",
        })
      })

      expect(result.current.outgoingSignals[peerA]).toHaveLength(1)
      expect(result.current.outgoingSignals[peerA][0]).toEqual({
        type: "offer",
        sdp: "test",
      })
    })

    it("accumulates multiple signals for same peer", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      act(() => {
        result.current.queueOutgoingSignal(peerA, {
          type: "offer",
          sdp: "offer",
        })
        result.current.queueOutgoingSignal(peerA, {
          type: "candidate",
          candidate: "ice1",
        })
        result.current.queueOutgoingSignal(peerA, {
          type: "candidate",
          candidate: "ice2",
        })
      })

      expect(result.current.outgoingSignals[peerA]).toHaveLength(3)
    })

    it("keeps signals separate for different peers", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      act(() => {
        result.current.queueOutgoingSignal(peerA, {
          type: "offer",
          sdp: "offerA",
        })
        result.current.queueOutgoingSignal(peerB, {
          type: "offer",
          sdp: "offerB",
        })
      })

      expect(result.current.outgoingSignals[peerA]).toHaveLength(1)
      expect(result.current.outgoingSignals[peerB]).toHaveLength(1)
      expect(result.current.outgoingSignals[peerA][0].sdp).toBe("offerA")
      expect(result.current.outgoingSignals[peerB][0].sdp).toBe("offerB")
    })
  })

  describe("clearOutgoingSignals", () => {
    it("removes signals for specified peer", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      act(() => {
        result.current.queueOutgoingSignal(peerA, { type: "offer" })
        result.current.queueOutgoingSignal(peerB, { type: "offer" })
      })

      expect(result.current.outgoingSignals[peerA]).toBeDefined()
      expect(result.current.outgoingSignals[peerB]).toBeDefined()

      act(() => {
        result.current.clearOutgoingSignals(peerA)
      })

      expect(result.current.outgoingSignals[peerA]).toBeUndefined()
      expect(result.current.outgoingSignals[peerB]).toBeDefined()
    })

    it("does nothing if peer has no signals", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      act(() => {
        result.current.clearOutgoingSignals(peerA)
      })

      expect(result.current.outgoingSignals[peerA]).toBeUndefined()
    })
  })

  describe("filterNewSignals", () => {
    it("returns all signals on first call", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      const signals: SignalData[] = [
        { type: "offer", sdp: "test" },
        { type: "candidate", candidate: "ice1" },
      ]

      let newSignals: SignalData[]
      act(() => {
        newSignals = result.current.filterNewSignals(peerA, signals)
      })

      expect(newSignals!).toHaveLength(2)
    })

    it("filters out already processed signals", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      const signals: SignalData[] = [
        { type: "offer", sdp: "test" },
        { type: "candidate", candidate: "ice1" },
      ]

      // First call - all signals are new
      act(() => {
        result.current.filterNewSignals(peerA, signals)
      })

      // Second call with same signals - none are new
      let newSignals: SignalData[]
      act(() => {
        newSignals = result.current.filterNewSignals(peerA, signals)
      })

      expect(newSignals!).toHaveLength(0)
    })

    it("returns only new signals when mixed with processed ones", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      const initialSignals: SignalData[] = [{ type: "offer", sdp: "test" }]
      const mixedSignals: SignalData[] = [
        { type: "offer", sdp: "test" }, // Already processed
        { type: "candidate", candidate: "ice1" }, // New
      ]

      act(() => {
        result.current.filterNewSignals(peerA, initialSignals)
      })

      let newSignals: SignalData[]
      act(() => {
        newSignals = result.current.filterNewSignals(peerA, mixedSignals)
      })

      expect(newSignals!).toHaveLength(1)
      expect(newSignals![0]).toEqual({ type: "candidate", candidate: "ice1" })
    })

    it("tracks signals separately per peer", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      const signal: SignalData = { type: "offer", sdp: "test" }

      // Process signal from peer A
      act(() => {
        result.current.filterNewSignals(peerA, [signal])
      })

      // Same signal from peer B should still be new
      let newSignals: SignalData[]
      act(() => {
        newSignals = result.current.filterNewSignals(peerB, [signal])
      })

      expect(newSignals!).toHaveLength(1)
    })

    it("handles empty signal array", () => {
      const { result } = renderHook(() => useSignalChannel(testInstanceId))

      let newSignals: SignalData[]
      act(() => {
        newSignals = result.current.filterNewSignals(peerA, [])
      })

      expect(newSignals!).toHaveLength(0)
    })
  })
})
