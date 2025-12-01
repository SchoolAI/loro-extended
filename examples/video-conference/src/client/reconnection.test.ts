import type { WebRtcDataChannelAdapter } from "@loro-extended/adapter-webrtc"
import type { PeerID } from "@loro-extended/repo"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SignalData, SignalingPresence } from "../shared/types"

// Store mock instances for inspection
const mockPeerInstances: MockPeer[] = []

interface MockPeer {
  initiator: boolean
  destroyed: boolean
  _events: Record<string, Array<(...args: unknown[]) => void>>
  on: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => void
  signal: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  connected: boolean
}

// Mock simple-peer
vi.mock("simple-peer/simplepeer.min.js", () => {
  return {
    default: vi.fn(),
  }
})

import Peer from "simple-peer/simplepeer.min.js"
import { useWebRtcMesh } from "./use-webrtc-mesh"

const MockedPeer = vi.mocked(Peer)

describe("useWebRtcMesh Reconnection", () => {
  // Use peer IDs where myPeerId > remotePeerId to make us the non-initiator
  const myPeerId: PeerID = "200000000000000000000000000000"
  const remotePeerId: PeerID = "100000000000000000000000000000"

  let mockSetSignalingPresence: ReturnType<typeof vi.fn>
  let mockLocalStream: MediaStream
  let mockWebrtcAdapter: WebRtcDataChannelAdapter

  beforeEach(() => {
    mockPeerInstances.length = 0

    // @ts-expect-error - mock implementation
    MockedPeer.mockImplementation((opts: { initiator: boolean }) => {
      const events: Record<string, Array<(...args: unknown[]) => void>> = {}

      const peer: MockPeer = {
        initiator: opts.initiator,
        destroyed: false,
        connected: false,
        _events: events,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!events[event]) {
            events[event] = []
          }
          events[event].push(handler)
          return peer
        }),
        emit: (event: string, ...args: unknown[]) => {
          if (event === "connect") peer.connected = true
          const handlers = events[event] || []
          for (const h of handlers) {
            h(...args)
          }
        },
        signal: vi.fn((data: any) => {
          // Simulate simple-peer behavior:
          // A non-initiator peer starts in "stable" state waiting for an offer.
          // If it receives an "answer" signal, it throws because you can't set
          // a remote answer when you haven't sent an offer.
          if (!opts.initiator && data.type === "answer") {
            // Emit error asynchronously to simulate real behavior
            setTimeout(() => {
              const err = new Error(
                "DOMException: Cannot set remote answer in state stable",
              )
              const handlers = events["error"] || []
              for (const h of handlers) {
                h(err)
              }
            }, 0)
          }
        }),
        destroy: vi.fn(() => {
          peer.destroyed = true
          peer.connected = false
        }),
      }

      mockPeerInstances.push(peer)
      return peer
    })

    mockSetSignalingPresence = vi.fn()
    mockLocalStream = {
      getTracks: () => [],
      getAudioTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream
    mockWebrtcAdapter = {
      attachDataChannel: vi.fn(),
      detachDataChannel: vi.fn(),
      hasDataChannel: vi.fn(() => false),
      getAttachedPeerIds: vi.fn(() => []),
    } as unknown as WebRtcDataChannelAdapter
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("stale signal handling", () => {
    it("non-initiator should NOT pass answer signals to simple-peer", async () => {
      // Suppress console output
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {})
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {})

      // Scenario: We are the non-initiator (myPeerId > remotePeerId).
      // The remote peer's presence contains an old "answer" signal addressed to us.
      // This could happen if:
      // 1. We previously connected (exchanged offer/answer)
      // 2. We left the room (our peer was destroyed)
      // 3. We rejoined (new peer instance, but old signals still in presence)
      //
      // EXPECTED BEHAVIOR: The answer signal should be IGNORED because:
      // - A non-initiator peer should only receive "offer" signals
      // - Receiving an "answer" when you haven't sent an offer is invalid

      const staleAnswerSignal: SignalData = {
        type: "answer",
        sdp: "stale-answer-sdp",
        targetInstanceId: "old-instance-id",
      }
      const presenceWithStaleSignal: Record<string, SignalingPresence> = {
        [remotePeerId]: {
          instanceId: "remote-instance-1",
          signals: {
            [myPeerId]: [staleAnswerSignal],
          },
        },
      }

      const { result } = renderHook(() =>
        useWebRtcMesh(
          myPeerId,
          mockLocalStream,
          [myPeerId, remotePeerId],
          presenceWithStaleSignal,
          mockSetSignalingPresence,
          mockWebrtcAdapter,
        ),
      )

      // Wait a bit to ensure no peer is created from the stale signal
      await new Promise(resolve => setTimeout(resolve, 100))

      // EXPECTED: No peer should be created because the signal should be ignored
      // The signal targets "old-instance-id", but our new instance has a random UUID
      expect(mockPeerInstances.length).toBe(0)

      // Connection state should be undefined (not even connecting) because we ignored the signal
      expect(result.current.connectionStates.get(remotePeerId)).toBeUndefined()

      consoleErrorSpy.mockRestore()
      consoleLogSpy.mockRestore()
    })

    it("non-initiator succeeds when receiving valid offer signal", async () => {
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {})

      // Valid scenario: non-initiator receives an offer (not an answer)
      const validOfferSignal: SignalData = {
        type: "offer",
        sdp: "valid-offer-sdp",
      }
      const presenceWithOffer: Record<string, SignalingPresence> = {
        [remotePeerId]: {
          instanceId: "remote-instance-1",
          signals: {
            [myPeerId]: [validOfferSignal],
          },
        },
      }

      const { result } = renderHook(() =>
        useWebRtcMesh(
          myPeerId,
          mockLocalStream,
          [myPeerId, remotePeerId],
          presenceWithOffer,
          mockSetSignalingPresence,
          mockWebrtcAdapter,
        ),
      )

      // Wait for peer to be created
      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      // The peer should be a non-initiator
      expect(mockPeerInstances[0].initiator).toBe(false)

      // The offer signal should have been passed to the peer
      expect(mockPeerInstances[0].signal).toHaveBeenCalledWith(validOfferSignal)

      // Connection state should still be "connecting" (no error)
      expect(result.current.connectionStates.get(remotePeerId)).toBe(
        "connecting",
      )

      consoleLogSpy.mockRestore()
    })

    it("signal deduplication is reset after unmount/remount", async () => {
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {})

      const offerSignal: SignalData = {
        type: "offer",
        sdp: "test-offer-sdp",
      }
      const presence: Record<string, SignalingPresence> = {
        [remotePeerId]: {
          instanceId: "remote-instance-1",
          signals: {
            [myPeerId]: [offerSignal],
          },
        },
      }

      // First mount - signal is processed
      const { unmount: unmount1 } = renderHook(() =>
        useWebRtcMesh(
          myPeerId,
          mockLocalStream,
          [myPeerId, remotePeerId],
          presence,
          mockSetSignalingPresence,
          mockWebrtcAdapter,
        ),
      )

      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      expect(mockPeerInstances[0].signal).toHaveBeenCalledTimes(1)

      // Unmount (simulates leaving the room)
      unmount1()

      // Clear instances for second mount
      mockPeerInstances.length = 0

      // Second mount with SAME presence (stale signals still there)
      // This simulates rejoining when old signals haven't been cleared
      renderHook(() =>
        useWebRtcMesh(
          myPeerId,
          mockLocalStream,
          [myPeerId, remotePeerId],
          presence, // Same presence with same signals
          mockSetSignalingPresence,
          mockWebrtcAdapter,
        ),
      )

      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      // BUG: The signal is processed AGAIN because processedSignalsRef was reset
      // This is the root cause of the reconnection bug
      expect(mockPeerInstances[0].signal).toHaveBeenCalledTimes(1)

      consoleLogSpy.mockRestore()
    })

    it("initiator receiving stale answer after reconnect causes error", async () => {
      // Swap IDs so we are the initiator (myPeerId < remotePeerId)
      const initiatorPeerId: PeerID = "100000000000000000000000000000"
      const responderPeerId: PeerID = "200000000000000000000000000000"

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {})
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {})

      // Scenario:
      // 1. Initiator and responder connected previously
      // 2. Initiator left and rejoined
      // 3. Responder's old "answer" is still in presence
      // 4. New initiator peer hasn't sent an offer yet, but receives the old answer

      // First, let the initiator create a peer (it will send an offer)
      const { unmount: unmount1 } = renderHook(() =>
        useWebRtcMesh(
          initiatorPeerId,
          mockLocalStream,
          [initiatorPeerId, responderPeerId],
          {}, // No signals yet
          mockSetSignalingPresence,
          mockWebrtcAdapter,
        ),
      )

      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      // Initiator peer was created
      expect(mockPeerInstances[0].initiator).toBe(true)

      // Simulate the initiator emitting an offer
      act(() => {
        mockPeerInstances[0].emit("signal", { type: "offer", sdp: "offer-sdp" })
      })

      // Unmount (leave room)
      unmount1()
      mockPeerInstances.length = 0

      // Now rejoin with stale answer in presence
      // This answer was from the previous session
      const staleAnswer: SignalData = {
        type: "answer",
        sdp: "stale-answer-from-responder",
        targetInstanceId: "old-instance-id",
      }
      const presenceWithStaleAnswer: Record<string, SignalingPresence> = {
        [responderPeerId]: {
          instanceId: "remote-instance-1",
          signals: {
            [initiatorPeerId]: [staleAnswer],
          },
        },
      }

      renderHook(() =>
        useWebRtcMesh(
          initiatorPeerId,
          mockLocalStream,
          [initiatorPeerId, responderPeerId],
          presenceWithStaleAnswer,
          mockSetSignalingPresence,
          mockWebrtcAdapter,
        ),
      )

      // Wait for peer creation
      // The initiator will create a peer AND process the stale answer
      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      // The new initiator peer receives the stale answer before it has sent its new offer
      // This could cause issues depending on timing
      // BUT it should NOT process the stale answer because it targets the old instance
      expect(mockPeerInstances[0].signal).not.toHaveBeenCalledWith(staleAnswer)

      consoleErrorSpy.mockRestore()
      consoleLogSpy.mockRestore()
    })
  })

  // Removed "proposed fix validation" block as it is redundant with the "stale signal handling" tests
})
