import { describe, expect, it } from "vitest"
import {
  EmptyRoom,
  EmptySignalingPresence,
  EmptyUserPresence,
  type SignalingPresence,
  type SignalsMap,
  type UserPresence,
} from "./types"

describe("Room Schema", () => {
  describe("EmptyRoom", () => {
    it("has empty metadata", () => {
      expect(EmptyRoom.metadata.name).toBe("")
      expect(EmptyRoom.metadata.createdAt).toBe(0)
    })

    it("has empty participants list", () => {
      expect(EmptyRoom.participants).toEqual([])
    })
  })
})

describe("User Presence", () => {
  describe("EmptyUserPresence", () => {
    it("has default name", () => {
      expect(EmptyUserPresence.name).toBe("Anonymous")
    })

    it("has audio and video enabled by default", () => {
      expect(EmptyUserPresence.wantsAudio).toBe(true)
      expect(EmptyUserPresence.wantsVideo).toBe(true)
    })
  })

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

    it("can be spread-updated", () => {
      const original: UserPresence = { ...EmptyUserPresence }

      const updated: UserPresence = {
        ...original,
        wantsAudio: false,
      }

      expect(updated.wantsAudio).toBe(false)
      expect(updated.wantsVideo).toBe(true) // unchanged
      expect(updated.name).toBe("Anonymous") // unchanged
    })
  })
})

describe("Signaling Presence", () => {
  describe("EmptySignalingPresence", () => {
    it("has empty signals", () => {
      expect(EmptySignalingPresence.signals).toEqual({})
    })
  })

  describe("SignalingPresence type", () => {
    it("can hold signals for multiple peers", () => {
      const presence: SignalingPresence = {
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
        signals: {
          "peer-1": [
            { type: "offer", sdp: "..." },
            { type: "candidate", candidate: "..." },
            { type: "candidate", candidate: "..." },
          ],
        },
      }

      expect(presence.signals["peer-1"]).toHaveLength(3)
    })

    it("can be spread-updated", () => {
      const original: SignalingPresence = { ...EmptySignalingPresence }

      const updated: SignalingPresence = {
        ...original,
        signals: {
          "peer-1": [{ type: "offer", sdp: "..." }],
        },
      }

      expect(updated.signals["peer-1"]).toHaveLength(1)
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
      { type: "candidate", candidate: "..." },
    ]

    expect(signals["peer-1"]).toHaveLength(2)
  })
})
