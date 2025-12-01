/**
 * Test to demonstrate the signal accumulation bug that causes PayloadTooLargeError.
 *
 * The issue: WebRTC signals (offers, answers, ICE candidates) accumulate in the
 * outgoingSignals state and are never cleared after connections are established.
 * This causes the presence payload to grow unbounded, eventually exceeding the
 * server's body-parser limit (default 100kb).
 *
 * This test simulates a realistic WebRTC signaling scenario to demonstrate
 * how quickly the payload can grow.
 */
import type { PeerID } from "@loro-extended/repo"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { SignalData, SignalingPresence } from "../../shared/types"
import { useSignalChannel } from "./use-signal-channel"

describe("Signal Accumulation Bug", () => {
  // Realistic peer IDs
  const peerA = "100000000000000000000000000000" as PeerID
  const peerB = "200000000000000000000000000000" as PeerID
  const peerC = "300000000000000000000000000000" as PeerID

  // Realistic SDP offer (truncated but representative size)
  const createRealisticOffer = (): SignalData => ({
    type: "offer",
    sdp: `v=0
o=- 1234567890 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1
a=extmap-allow-mixed
a=msid-semantic: WMS
m=audio 9 UDP/TLS/RTP/SAVPF 111 103 104 9 0 8 106 105 13 110 112 113 126
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:abcd
a=ice-pwd:abcdefghijklmnopqrstuvwx
a=ice-options:trickle
a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=sendrecv
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101 102 121 127 120 125 107 108 109 124 119 123
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:abcd
a=ice-pwd:abcdefghijklmnopqrstuvwx
a=ice-options:trickle
a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99
a=setup:actpass
a=mid:1
a=extmap:14 urn:ietf:params:rtp-hdrext:toffset
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=sendrecv
a=rtcp-mux
a=rtcp-rsize
a=rtpmap:96 VP8/90000
a=rtcp-fb:96 goog-remb
a=rtcp-fb:96 transport-cc
a=rtcp-fb:96 ccm fir
a=rtcp-fb:96 nack
a=rtcp-fb:96 nack pli`,
  })

  // Realistic ICE candidate
  const createRealisticCandidate = (index: number): SignalData => ({
    type: "candidate",
    candidate: {
      candidate: `candidate:${index} 1 udp 2122260223 192.168.1.${100 + index} ${50000 + index} typ host generation 0 ufrag abcd network-id 1`,
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "abcd",
    },
  })

  /**
   * Calculate the size of the signaling presence payload that would be sent
   * over the network.
   */
  function calculatePresencePayloadSize(
    outgoingSignals: Record<string, SignalData[]>,
    instanceId: string,
  ): number {
    const presence: SignalingPresence = {
      instanceId,
      signals: outgoingSignals,
    }
    return JSON.stringify(presence).length
  }

  it("demonstrates that signals accumulate without being cleared", () => {
    const { result } = renderHook(() => useSignalChannel("test-instance-id"))

    // Simulate a typical WebRTC connection establishment:
    // 1. Send offer
    // 2. Receive answer (not tracked in outgoing)
    // 3. Send multiple ICE candidates (trickle ICE)

    act(() => {
      // Send offer to peer B
      result.current.queueOutgoingSignal(peerB, createRealisticOffer())

      // Send ICE candidates (typically 5-20 candidates per connection)
      for (let i = 0; i < 10; i++) {
        result.current.queueOutgoingSignal(peerB, createRealisticCandidate(i))
      }
    })

    // Verify signals accumulated
    expect(result.current.outgoingSignals[peerB]).toHaveLength(11) // 1 offer + 10 candidates

    // Calculate payload size
    const payloadSize = calculatePresencePayloadSize(
      result.current.outgoingSignals,
      "test-instance-id",
    )

    console.log(`Payload size after one peer connection: ${payloadSize} bytes`)

    // Even with just one peer, the payload is already substantial
    expect(payloadSize).toBeGreaterThan(2000) // ~2KB for one connection
  })

  it("shows payload grows linearly with number of peers", () => {
    const { result } = renderHook(() => useSignalChannel("test-instance-id"))

    const peers = [peerA, peerB, peerC]

    act(() => {
      for (const peer of peers) {
        // Each peer gets an offer and ICE candidates
        result.current.queueOutgoingSignal(peer, createRealisticOffer())
        for (let i = 0; i < 10; i++) {
          result.current.queueOutgoingSignal(peer, createRealisticCandidate(i))
        }
      }
    })

    const payloadSize = calculatePresencePayloadSize(
      result.current.outgoingSignals,
      "test-instance-id",
    )

    console.log(`Payload size with ${peers.length} peers: ${payloadSize} bytes`)

    // With 3 peers, payload is ~6KB
    expect(payloadSize).toBeGreaterThan(6000)
  })

  it("shows payload grows unbounded over time without clearing", () => {
    const { result } = renderHook(() => useSignalChannel("test-instance-id"))

    // Simulate multiple connection attempts (e.g., reconnections, renegotiations)
    const connectionAttempts = 5

    act(() => {
      for (let attempt = 0; attempt < connectionAttempts; attempt++) {
        // Each attempt adds more signals
        result.current.queueOutgoingSignal(peerB, createRealisticOffer())
        for (let i = 0; i < 10; i++) {
          result.current.queueOutgoingSignal(
            peerB,
            createRealisticCandidate(attempt * 10 + i),
          )
        }
      }
    })

    // All signals accumulated - nothing was cleared!
    expect(result.current.outgoingSignals[peerB]).toHaveLength(
      connectionAttempts * 11,
    )

    const payloadSize = calculatePresencePayloadSize(
      result.current.outgoingSignals,
      "test-instance-id",
    )

    console.log(
      `Payload size after ${connectionAttempts} connection attempts: ${payloadSize} bytes`,
    )

    // After 5 attempts, payload is ~10KB for just one peer
    expect(payloadSize).toBeGreaterThan(10000)
  })

  it("demonstrates clearOutgoingSignals prevents accumulation", () => {
    const { result } = renderHook(() => useSignalChannel("test-instance-id"))

    // Simulate connection establishment
    act(() => {
      result.current.queueOutgoingSignal(peerB, createRealisticOffer())
      for (let i = 0; i < 10; i++) {
        result.current.queueOutgoingSignal(peerB, createRealisticCandidate(i))
      }
    })

    const sizeBeforeClear = calculatePresencePayloadSize(
      result.current.outgoingSignals,
      "test-instance-id",
    )

    // Clear signals after connection is established (THE FIX)
    act(() => {
      result.current.clearOutgoingSignals(peerB)
    })

    const sizeAfterClear = calculatePresencePayloadSize(
      result.current.outgoingSignals,
      "test-instance-id",
    )

    console.log(`Payload size before clear: ${sizeBeforeClear} bytes`)
    console.log(`Payload size after clear: ${sizeAfterClear} bytes`)

    // After clearing, payload should be minimal (just the instanceId and empty signals object)
    expect(sizeAfterClear).toBeLessThan(100)
    expect(result.current.outgoingSignals[peerB]).toBeUndefined()
  })

  it("calculates realistic worst-case scenario that exceeds 100KB limit", () => {
    const { result } = renderHook(() => useSignalChannel("test-instance-id"))

    // Simulate a video conference with 10 participants
    // Each participant has multiple connection attempts due to network issues
    const numPeers = 10
    const connectionAttemptsPerPeer = 3
    const candidatesPerAttempt = 15 // More candidates in complex network environments

    const peers = Array.from(
      { length: numPeers },
      (_, i) => `${(i + 1) * 100}000000000000000000000000000` as PeerID,
    )

    act(() => {
      for (const peer of peers) {
        for (let attempt = 0; attempt < connectionAttemptsPerPeer; attempt++) {
          result.current.queueOutgoingSignal(peer, createRealisticOffer())
          for (let i = 0; i < candidatesPerAttempt; i++) {
            result.current.queueOutgoingSignal(
              peer,
              createRealisticCandidate(attempt * candidatesPerAttempt + i),
            )
          }
        }
      }
    })

    const payloadSize = calculatePresencePayloadSize(
      result.current.outgoingSignals,
      "test-instance-id",
    )

    console.log(`Worst-case payload size: ${payloadSize} bytes`)
    console.log(`Express default limit: 102400 bytes (100KB)`)
    console.log(`Exceeds limit: ${payloadSize > 102400}`)

    // This demonstrates the bug: the payload can easily exceed 100KB
    // In a real scenario with 10 peers and reconnection attempts,
    // the payload grows to ~150KB+, exceeding the default body-parser limit
    expect(payloadSize).toBeGreaterThan(50000) // At least 50KB in this scenario
  })

  describe("Fix verification", () => {
    it("signals should be cleared when connection is established (simulated)", () => {
      const { result } = renderHook(() => useSignalChannel("test-instance-id"))

      // Simulate connection establishment to multiple peers
      const peers = [peerA, peerB, peerC]

      act(() => {
        for (const peer of peers) {
          // Queue signals for each peer
          result.current.queueOutgoingSignal(peer, createRealisticOffer())
          for (let i = 0; i < 10; i++) {
            result.current.queueOutgoingSignal(
              peer,
              createRealisticCandidate(i),
            )
          }
        }
      })

      // Verify signals accumulated
      const sizeBeforeFix = calculatePresencePayloadSize(
        result.current.outgoingSignals,
        "test-instance-id",
      )
      expect(sizeBeforeFix).toBeGreaterThan(6000)

      // Simulate connections being established (THE FIX)
      // In the real implementation, this is called by usePeerManager's onConnected callback
      act(() => {
        for (const peer of peers) {
          result.current.clearOutgoingSignals(peer)
        }
      })

      // Verify signals are cleared
      const sizeAfterFix = calculatePresencePayloadSize(
        result.current.outgoingSignals,
        "test-instance-id",
      )

      console.log(`Payload size before fix: ${sizeBeforeFix} bytes`)
      console.log(`Payload size after fix: ${sizeAfterFix} bytes`)

      // After clearing all peers, payload should be minimal
      expect(sizeAfterFix).toBeLessThan(100)
      expect(result.current.outgoingSignals[peerA]).toBeUndefined()
      expect(result.current.outgoingSignals[peerB]).toBeUndefined()
      expect(result.current.outgoingSignals[peerC]).toBeUndefined()
    })

    it("new signals can still be queued after clearing (for renegotiation)", () => {
      const { result } = renderHook(() => useSignalChannel("test-instance-id"))

      // Initial connection
      act(() => {
        result.current.queueOutgoingSignal(peerA, createRealisticOffer())
      })

      // Connection established - clear signals
      act(() => {
        result.current.clearOutgoingSignals(peerA)
      })

      expect(result.current.outgoingSignals[peerA]).toBeUndefined()

      // Later renegotiation - new signals can be queued
      act(() => {
        result.current.queueOutgoingSignal(peerA, {
          type: "offer",
          sdp: "renegotiation-offer",
        })
      })

      // New signals are queued correctly
      expect(result.current.outgoingSignals[peerA]).toHaveLength(1)
      expect(result.current.outgoingSignals[peerA][0].sdp).toBe(
        "renegotiation-offer",
      )
    })
  })
})
