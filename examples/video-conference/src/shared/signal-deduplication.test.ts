import type { PeerID } from "@loro-extended/repo"
import { describe, expect, it } from "vitest"

/**
 * Signal deduplication strategy tests.
 *
 * The current implementation uses JSON.stringify for deduplication which:
 * - Creates large strings for each signal
 * - Has unbounded memory growth in processedSignalsRef
 *
 * The improved implementation should use sequence numbers for:
 * - O(1) deduplication
 * - Bounded memory (just one number per peer)
 */

describe("Signal Deduplication", () => {
  describe("Current approach: JSON.stringify", () => {
    it("creates unique IDs for different signals", () => {
      const fromPeerId = "12345" as PeerID
      const signal1 = { type: "offer", sdp: "sdp-data-1" }
      const signal2 = { type: "offer", sdp: "sdp-data-2" }

      const id1 = `${fromPeerId}:${JSON.stringify(signal1)}`
      const id2 = `${fromPeerId}:${JSON.stringify(signal2)}`

      expect(id1).not.toBe(id2)
    })

    it("creates same ID for identical signals (deduplication works)", () => {
      const fromPeerId = "12345" as PeerID
      const signal = { type: "offer", sdp: "sdp-data" }

      const id1 = `${fromPeerId}:${JSON.stringify(signal)}`
      const id2 = `${fromPeerId}:${JSON.stringify(signal)}`

      expect(id1).toBe(id2)
    })

    it("demonstrates memory issue: large strings for ICE candidates", () => {
      const fromPeerId = "12345" as PeerID
      const iceCandidate = {
        type: "candidate",
        candidate: {
          candidate:
            "candidate:1 1 UDP 2122252543 192.168.1.100 54321 typ host generation 0 ufrag abc123 network-id 1",
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: "abc123",
        },
      }

      const signalId = `${fromPeerId}:${JSON.stringify(iceCandidate)}`

      // This creates a ~200+ character string for each ICE candidate
      // With trickle ICE, we might get 10-20 candidates per peer
      expect(signalId.length).toBeGreaterThan(150)
    })
  })

  describe("Improved approach: Sequence numbers", () => {
    type SignalWithSeq = {
      seq: number
      data: unknown
    }

    /**
     * Simulates the improved deduplication logic using sequence numbers.
     * Returns signals that haven't been processed yet.
     */
    function processSignalsWithSeq(
      signals: SignalWithSeq[],
      lastProcessedSeq: number,
    ): { newSignals: SignalWithSeq[]; newLastSeq: number } {
      const newSignals = signals.filter(s => s.seq > lastProcessedSeq)
      const newLastSeq =
        newSignals.length > 0
          ? Math.max(...newSignals.map(s => s.seq))
          : lastProcessedSeq

      return { newSignals, newLastSeq }
    }

    it("processes new signals with higher sequence numbers", () => {
      const signals: SignalWithSeq[] = [
        { seq: 1, data: { type: "offer" } },
        { seq: 2, data: { type: "candidate", candidate: "ice1" } },
        { seq: 3, data: { type: "candidate", candidate: "ice2" } },
      ]

      const { newSignals, newLastSeq } = processSignalsWithSeq(signals, 0)

      expect(newSignals).toHaveLength(3)
      expect(newLastSeq).toBe(3)
    })

    it("skips already processed signals", () => {
      const signals: SignalWithSeq[] = [
        { seq: 1, data: { type: "offer" } },
        { seq: 2, data: { type: "candidate", candidate: "ice1" } },
        { seq: 3, data: { type: "candidate", candidate: "ice2" } },
      ]

      // Already processed up to seq 2
      const { newSignals, newLastSeq } = processSignalsWithSeq(signals, 2)

      expect(newSignals).toHaveLength(1)
      expect(newSignals[0].seq).toBe(3)
      expect(newLastSeq).toBe(3)
    })

    it("handles empty signals array", () => {
      const { newSignals, newLastSeq } = processSignalsWithSeq([], 5)

      expect(newSignals).toHaveLength(0)
      expect(newLastSeq).toBe(5)
    })

    it("handles all signals already processed", () => {
      const signals: SignalWithSeq[] = [
        { seq: 1, data: { type: "offer" } },
        { seq: 2, data: { type: "candidate" } },
      ]

      const { newSignals, newLastSeq } = processSignalsWithSeq(signals, 10)

      expect(newSignals).toHaveLength(0)
      expect(newLastSeq).toBe(10)
    })

    it("uses O(1) memory per peer (just one number)", () => {
      // With sequence numbers, we only need to track one number per peer
      const lastProcessedSeqPerPeer = new Map<PeerID, number>()

      // Process signals from peer A
      lastProcessedSeqPerPeer.set("peerA" as PeerID, 5)

      // Process signals from peer B
      lastProcessedSeqPerPeer.set("peerB" as PeerID, 3)

      // Memory is bounded: O(number of peers), not O(number of signals)
      expect(lastProcessedSeqPerPeer.size).toBe(2)
    })

    it("handles out-of-order signal delivery", () => {
      // Signals might arrive out of order due to network conditions
      const signals: SignalWithSeq[] = [
        { seq: 3, data: { type: "candidate", candidate: "ice2" } },
        { seq: 1, data: { type: "offer" } },
        { seq: 2, data: { type: "candidate", candidate: "ice1" } },
      ]

      const { newSignals, newLastSeq } = processSignalsWithSeq(signals, 0)

      // All signals should be processed
      expect(newSignals).toHaveLength(3)
      expect(newLastSeq).toBe(3)
    })
  })
})
