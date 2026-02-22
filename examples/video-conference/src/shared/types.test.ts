import { describe, expect, it } from "vitest"
import type { SignalingPresence, SignalsMap, UserPresence } from "./types"

describe("User Presence", () => {
  describe("UserPresence type", () => {
    it("can be created with custom values", () => {
      const presence: UserPresence = {
        name: "Test User",
        wantsAudio: false,
        wantsVideo: true,
      }

      expect(presence.name).toBe("Test User")
      expect(presence.wantsAudio).toBe(false)
      expect(presence.wantsVideo).toBe(true)
    })
  })
})

describe("Signaling Presence", () => {
  describe("SignalingPresence type", () => {
    it("can hold signals for multiple peers", () => {
      const presence: SignalingPresence = {
        instanceId: "test-instance",
        signals: {
          "peer-1": [{ type: "offer", sdp: "..." }],
          "peer-2": [{ type: "answer", sdp: "..." }],
        },
      }

      expect(Object.keys(presence.signals)).toHaveLength(2)
      expect(presence.signals["peer-1"]).toHaveLength(1)
      expect(presence.signals["peer-2"]).toHaveLength(1)
    })

    it("can accumulate multiple signals per peer", () => {
      const presence: SignalingPresence = {
        instanceId: "test-instance",
        signals: {
          "peer-1": [
            { type: "offer", sdp: "..." },
            { type: "candidate", candidate: { candidate: "ice1" } },
            { type: "candidate", candidate: { candidate: "ice2" } },
          ],
        },
      }

      expect(presence.signals["peer-1"]).toHaveLength(3)
    })
  })
})

describe("SignalsMap", () => {
  it("supports dynamic peer ID keys", () => {
    const signals: SignalsMap = {}

    // Add signals for a peer
    const peerId = "12345678901234567890"
    signals[peerId] = [{ type: "offer", sdp: "v=0..." }]

    expect(signals[peerId]).toHaveLength(1)
  })

  it("supports appending signals", () => {
    const signals: SignalsMap = {
      "peer-1": [{ type: "offer", sdp: "..." }],
    }

    // Append a new signal
    signals["peer-1"] = [
      ...signals["peer-1"],
      { type: "candidate", candidate: { candidate: "ice1" } },
    ]

    expect(signals["peer-1"]).toHaveLength(2)
  })
})
