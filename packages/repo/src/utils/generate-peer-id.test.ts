import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { generatePeerId } from "./generate-peer-id.js"

describe("generatePeerId", () => {
  it("should generate a valid PeerID", () => {
    const peerId = generatePeerId()

    // Should be a string
    expect(typeof peerId).toBe("string")

    // Should contain only digits
    expect(/^\d+$/.test(peerId)).toBe(true)

    // Should be non-empty
    expect(peerId.length).toBeGreaterThan(0)
  })

  it("should generate unique PeerIDs", () => {
    const peerIds = new Set<string>()
    const count = 1000

    for (let i = 0; i < count; i++) {
      peerIds.add(generatePeerId())
    }

    // All generated IDs should be unique
    expect(peerIds.size).toBe(count)
  })

  it("should generate PeerIDs that Loro accepts", () => {
    const peerId = generatePeerId()
    const doc = new LoroDoc()

    // Should not throw when setting the peer ID
    expect(() => doc.setPeerId(peerId)).not.toThrow()

    // Should be retrievable
    expect(doc.peerIdStr).toBe(peerId)
  })

  it("should generate PeerIDs within valid range", () => {
    // PeerID must be an unsigned 64-bit integer
    const maxUint64 = BigInt("18446744073709551615") // 2^64 - 1

    for (let i = 0; i < 100; i++) {
      const peerId = generatePeerId()
      const value = BigInt(peerId)

      // Should be >= 0
      expect(value >= 0n).toBe(true)

      // Should be <= max uint64
      expect(value <= maxUint64).toBe(true)
    }
  })

  it("should work with multiple documents", () => {
    const doc1 = new LoroDoc()
    const doc2 = new LoroDoc()
    const doc3 = new LoroDoc()

    const peerId1 = generatePeerId()
    const peerId2 = generatePeerId()
    const peerId3 = generatePeerId()

    doc1.setPeerId(peerId1)
    doc2.setPeerId(peerId2)
    doc3.setPeerId(peerId3)

    expect(doc1.peerIdStr).toBe(peerId1)
    expect(doc2.peerIdStr).toBe(peerId2)
    expect(doc3.peerIdStr).toBe(peerId3)

    // All should be different
    expect(peerId1).not.toBe(peerId2)
    expect(peerId2).not.toBe(peerId3)
    expect(peerId1).not.toBe(peerId3)
  })
})
