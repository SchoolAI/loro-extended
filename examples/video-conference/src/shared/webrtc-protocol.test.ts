import type { PeerID } from "@loro-extended/repo"
import { describe, expect, it } from "vitest"
import {
  createSignalId,
  fastHash,
  ICE_SERVERS,
  shouldInitiate,
} from "./webrtc-protocol"

describe("webrtc-protocol", () => {
  describe("shouldInitiate", () => {
    it("returns true when myPeerId is numerically smaller", () => {
      const myPeerId = "100" as PeerID
      const remotePeerId = "200" as PeerID
      expect(shouldInitiate(myPeerId, remotePeerId)).toBe(true)
    })

    it("returns false when myPeerId is numerically larger", () => {
      const myPeerId = "200" as PeerID
      const remotePeerId = "100" as PeerID
      expect(shouldInitiate(myPeerId, remotePeerId)).toBe(false)
    })

    it("returns false when peerIds are equal", () => {
      const myPeerId = "100" as PeerID
      const remotePeerId = "100" as PeerID
      expect(shouldInitiate(myPeerId, remotePeerId)).toBe(false)
    })

    it("handles large numeric peer IDs correctly", () => {
      // These are realistic peer IDs that look like large numbers
      const smallerPeerId = "12345678901234567890" as PeerID
      const largerPeerId = "98765432109876543210" as PeerID

      expect(shouldInitiate(smallerPeerId, largerPeerId)).toBe(true)
      expect(shouldInitiate(largerPeerId, smallerPeerId)).toBe(false)
    })

    it("handles peer IDs that would overflow regular numbers", () => {
      // Numbers larger than Number.MAX_SAFE_INTEGER
      const peerA = "9007199254740993" as PeerID // MAX_SAFE_INTEGER + 2
      const peerB = "9007199254740994" as PeerID // MAX_SAFE_INTEGER + 3

      // Regular number comparison would fail here due to precision loss
      expect(shouldInitiate(peerA, peerB)).toBe(true)
      expect(shouldInitiate(peerB, peerA)).toBe(false)
    })

    it("is deterministic - same inputs always produce same output", () => {
      const peerA = "123456789012345678901234567890" as PeerID
      const peerB = "987654321098765432109876543210" as PeerID

      // Call multiple times to ensure determinism
      const result1 = shouldInitiate(peerA, peerB)
      const result2 = shouldInitiate(peerA, peerB)
      const result3 = shouldInitiate(peerA, peerB)

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })

    it("is symmetric - exactly one peer should initiate", () => {
      const peerA = "111111111111111111111111111111" as PeerID
      const peerB = "222222222222222222222222222222" as PeerID

      const aInitiates = shouldInitiate(peerA, peerB)
      const bInitiates = shouldInitiate(peerB, peerA)

      // Exactly one should be true (XOR)
      expect(aInitiates !== bInitiates).toBe(true)
    })
  })

  describe("fastHash", () => {
    it("returns a 14-character hex string", () => {
      const hash = fastHash("test message")
      expect(hash).toHaveLength(14)
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })

    it("returns same hash for same input", () => {
      const hash1 = fastHash("hello world")
      const hash2 = fastHash("hello world")
      expect(hash1).toBe(hash2)
    })

    it("returns different hash for different input", () => {
      const hash1 = fastHash("hello")
      const hash2 = fastHash("world")
      expect(hash1).not.toBe(hash2)
    })

    it("handles empty string", () => {
      const hash = fastHash("")
      expect(hash).toHaveLength(14)
    })

    it("handles large strings efficiently", () => {
      // Simulate a large SDP offer
      const largeSdp = "v=0\r\n" + "a=candidate:".repeat(1000)
      const hash = fastHash(largeSdp)
      expect(hash).toHaveLength(14)
    })
  })

  describe("createSignalId", () => {
    it("creates a fixed-size ID (14 chars) from peerId and signal", () => {
      const peerId = "12345" as PeerID
      const signal = { type: "offer", sdp: "v=0..." }

      const id = createSignalId(peerId, signal)

      expect(id).toHaveLength(14)
      expect(id).toMatch(/^[0-9a-f]+$/)
    })

    it("creates different IDs for different signals from same peer", () => {
      const peerId = "12345" as PeerID
      const signal1 = { type: "offer", sdp: "offer-sdp" }
      const signal2 = { type: "answer", sdp: "answer-sdp" }

      const id1 = createSignalId(peerId, signal1)
      const id2 = createSignalId(peerId, signal2)

      expect(id1).not.toBe(id2)
    })

    it("creates different IDs for same signal from different peers", () => {
      const peer1 = "11111" as PeerID
      const peer2 = "22222" as PeerID
      const signal = { type: "offer", sdp: "same-sdp" }

      const id1 = createSignalId(peer1, signal)
      const id2 = createSignalId(peer2, signal)

      expect(id1).not.toBe(id2)
    })

    it("creates same ID for identical peer+signal combination", () => {
      const peerId = "12345" as PeerID
      const signal = { type: "offer", sdp: "test-sdp" }

      const id1 = createSignalId(peerId, signal)
      const id2 = createSignalId(peerId, signal)

      expect(id1).toBe(id2)
    })

    it("handles ICE candidate signals with fixed-size output", () => {
      const peerId = "12345" as PeerID
      const iceCandidate = {
        type: "candidate",
        candidate: {
          candidate: "candidate:1 1 UDP 2122252543 192.168.1.1 12345 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      }

      const id = createSignalId(peerId, iceCandidate)

      // Fixed size regardless of signal content
      expect(id).toHaveLength(14)
    })

    it("handles null/undefined signals gracefully", () => {
      const peerId = "12345" as PeerID

      const nullId = createSignalId(peerId, null)
      const undefinedId = createSignalId(peerId, undefined)

      expect(nullId).toHaveLength(14)
      expect(undefinedId).toHaveLength(14)
      expect(nullId).not.toBe(undefinedId)
    })

    it("produces compact IDs even for large SDP offers", () => {
      const peerId = "12345" as PeerID
      // Simulate a realistic SDP offer (typically 2-5KB)
      const largeSdp = {
        type: "offer",
        sdp:
          "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n" +
          "a=candidate:".repeat(100) +
          "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n".repeat(10),
      }

      const id = createSignalId(peerId, largeSdp)

      // Always 14 chars, regardless of input size
      expect(id).toHaveLength(14)
    })
  })

  describe("ICE_SERVERS", () => {
    it("contains Google STUN servers", () => {
      const googleServers = ICE_SERVERS.filter(s =>
        s.urls.includes("google.com"),
      )
      expect(googleServers.length).toBeGreaterThan(0)
    })

    it("contains Twilio STUN server", () => {
      const twilioServers = ICE_SERVERS.filter(s =>
        s.urls.includes("twilio.com"),
      )
      expect(twilioServers.length).toBe(1)
    })

    it("all servers use STUN protocol", () => {
      for (const server of ICE_SERVERS) {
        expect(server.urls).toMatch(/^stun:/)
      }
    })

    it("has at least 3 servers for redundancy", () => {
      expect(ICE_SERVERS.length).toBeGreaterThanOrEqual(3)
    })
  })
})
