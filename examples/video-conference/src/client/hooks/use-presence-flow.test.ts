/**
 * Tests for presence data flow after Phase 3 (Presence Separation).
 *
 * The presence model is now split into:
 * - UserPresence: { name, wantsAudio, wantsVideo } - stable, low-frequency updates
 * - SignalingPresence: { signals } - high-frequency, transient WebRTC signals
 *
 * These tests document the separated presence behavior.
 */

import type { PeerID } from "@loro-extended/repo"
import { describe, expect, it } from "vitest"
import type {
  SignalData,
  SignalingPresence,
  UserPresence,
} from "../../shared/types"

describe("Presence Data Flow", () => {
  describe("UserPresence", () => {
    it("contains only user metadata", () => {
      const userPresence: UserPresence = {
        name: "Alice",
        wantsAudio: true,
        wantsVideo: false,
      }

      expect(userPresence.name).toBe("Alice")
      expect(userPresence.wantsAudio).toBe(true)
      expect(userPresence.wantsVideo).toBe(false)
      // @ts-expect-error - signals should not exist on UserPresence
      expect(userPresence.signals).toBeUndefined()
    })

    it("can be updated independently", () => {
      const original: UserPresence = {
        name: "Alice",
        wantsAudio: true,
        wantsVideo: true,
      }

      const updated: UserPresence = {
        ...original,
        wantsAudio: false,
      }

      expect(updated.wantsAudio).toBe(false)
      expect(updated.name).toBe("Alice") // unchanged
      expect(updated.wantsVideo).toBe(true) // unchanged
    })
  })

  describe("SignalingPresence", () => {
    it("contains only signals and instanceId", () => {
      const signalingPresence: SignalingPresence = {
        instanceId: "test-instance",
        signals: {
          "peer-123": [{ type: "offer", sdp: "..." }],
        },
      }

      expect(signalingPresence.signals["peer-123"]).toHaveLength(1)
      expect(signalingPresence.instanceId).toBe("test-instance")
      // @ts-expect-error - name should not exist on SignalingPresence
      expect(signalingPresence.name).toBeUndefined()
    })

    it("can be updated independently", () => {
      const original: SignalingPresence = {
        instanceId: "test-instance",
        signals: {},
      }

      const updated: SignalingPresence = {
        instanceId: original.instanceId,
        signals: {
          ...original.signals,
          "peer-456": [{ type: "offer", sdp: "v=0..." }],
        },
      }

      expect(updated.signals["peer-456"]).toHaveLength(1)
    })
  })

  describe("presence reading patterns", () => {
    it("can extract user metadata from user presence map", () => {
      const allUserPresence: Record<string, UserPresence> = {
        "peer-1": {
          name: "Alice",
          wantsAudio: true,
          wantsVideo: false,
        },
        "peer-2": {
          name: "Bob",
          wantsAudio: false,
          wantsVideo: true,
        },
      }

      const userMetadata = Object.entries(allUserPresence).map(
        ([peerId, p]) => ({
          peerId,
          name: p.name,
          wantsAudio: p.wantsAudio,
          wantsVideo: p.wantsVideo,
        }),
      )

      expect(userMetadata).toHaveLength(2)
      expect(userMetadata[0]).toEqual({
        peerId: "peer-1",
        name: "Alice",
        wantsAudio: true,
        wantsVideo: false,
      })
    })

    it("can extract signals addressed to a specific peer", () => {
      const myPeerId = "peer-1" as PeerID
      const allSignalingPresence: Record<string, SignalingPresence> = {
        "peer-2": {
          instanceId: "instance-2",
          signals: {
            "peer-1": [{ type: "offer", sdp: "offer-from-alice" }],
            "peer-3": [{ type: "offer", sdp: "offer-to-charlie" }],
          },
        },
        "peer-3": {
          instanceId: "instance-3",
          signals: {
            "peer-1": [{ type: "offer", sdp: "offer-from-charlie" }],
          },
        },
      }

      // Extract signals addressed to myPeerId
      const signalsForMe: Array<{ fromPeerId: string; signals: unknown[] }> = []
      for (const [fromPeerId, presence] of Object.entries(
        allSignalingPresence,
      )) {
        const signals = presence.signals[myPeerId]
        if (signals && signals.length > 0) {
          signalsForMe.push({ fromPeerId, signals })
        }
      }

      expect(signalsForMe).toHaveLength(2)
      expect(signalsForMe[0].fromPeerId).toBe("peer-2")
      expect(signalsForMe[0].signals[0]).toEqual({
        type: "offer",
        sdp: "offer-from-alice",
      })
    })
  })

  describe("presence update patterns", () => {
    it("updates signals without affecting user presence", () => {
      // With separated presence, we only update the signaling channel
      const currentSignaling: SignalingPresence = {
        instanceId: "test-instance",
        signals: {},
      }

      const targetPeerId = "peer-2"
      const newSignal: SignalData = { type: "offer", sdp: "v=0..." }

      const updatedSignaling: SignalingPresence = {
        instanceId: currentSignaling.instanceId,
        signals: {
          ...currentSignaling.signals,
          [targetPeerId]: [
            ...(currentSignaling.signals[targetPeerId] || []),
            newSignal,
          ],
        },
      }

      expect(updatedSignaling.signals[targetPeerId]).toHaveLength(1)
    })

    it("updates user metadata without affecting signals", () => {
      // With separated presence, we only update the user channel
      const currentUser: UserPresence = {
        name: "Alice",
        wantsAudio: true,
        wantsVideo: true,
      }

      const updatedUser: UserPresence = {
        ...currentUser,
        wantsAudio: false,
      }

      expect(updatedUser.wantsAudio).toBe(false)
      expect(updatedUser.name).toBe("Alice") // unchanged
    })
  })

  describe("separation benefits", () => {
    it("allows independent update frequencies", () => {
      // User presence updates infrequently (when user toggles audio/video)
      const userUpdates: UserPresence[] = [
        { name: "Alice", wantsAudio: true, wantsVideo: true },
        { name: "Alice", wantsAudio: false, wantsVideo: true }, // toggle audio
      ]

      // Signaling presence updates frequently (many signals during connection)
      const signalingUpdates: SignalingPresence[] = [
        { instanceId: "i1", signals: { "peer-2": [{ type: "offer" }] } },
        {
          instanceId: "i1",
          signals: { "peer-2": [{ type: "offer" }, { type: "candidate" }] },
        },
        {
          instanceId: "i1",
          signals: {
            "peer-2": [
              { type: "offer" },
              { type: "candidate" },
              { type: "candidate" },
            ],
          },
        },
        {
          instanceId: "i1",
          signals: {
            "peer-2": [
              { type: "offer" },
              { type: "candidate" },
              { type: "candidate" },
              { type: "candidate" },
            ],
          },
        },
      ]

      // User presence had 2 updates, signaling had 4
      // With combined presence, user metadata would be sent 4 times unnecessarily
      expect(userUpdates).toHaveLength(2)
      expect(signalingUpdates).toHaveLength(4)
    })
  })
})
