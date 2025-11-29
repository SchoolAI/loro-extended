import type { PeerID } from "@loro-extended/repo"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SignalingPresence } from "../shared/types"

// Store mock instances for inspection - must be defined before vi.mock
const mockPeerInstances: MockPeer[] = []

interface MockPeer {
  initiator: boolean
  destroyed: boolean
  _events: Record<string, Array<(...args: unknown[]) => void>>
  on: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => void
  signal: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

// Mock simple-peer - factory must not reference external variables
vi.mock("simple-peer/simplepeer.min.js", () => {
  return {
    default: vi.fn(),
  }
})

// Import after mocking
import Peer from "simple-peer/simplepeer.min.js"
import { useWebRtcMesh } from "./use-webrtc-mesh"

// Get the mocked constructor
const MockedPeer = vi.mocked(Peer)

describe("useWebRtcMesh", () => {
  const myPeerId = "100000000000000000000000000000" as PeerID
  const remotePeerId = "200000000000000000000000000000" as PeerID

  let mockSetSignalingPresence: ReturnType<typeof vi.fn>
  let mockLocalStream: MediaStream

  beforeEach(() => {
    // Clear the instances array
    mockPeerInstances.length = 0

    // Setup the mock implementation
    // @ts-expect-error - mock implementation doesn't match exact types
    MockedPeer.mockImplementation((opts: { initiator: boolean }) => {
      const events: Record<string, Array<(...args: unknown[]) => void>> = {}

      const peer: MockPeer = {
        initiator: opts.initiator,
        destroyed: false,
        _events: events,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!events[event]) {
            events[event] = []
          }
          events[event].push(handler)
          return peer
        }),
        emit: (event: string, ...args: unknown[]) => {
          const handlers = events[event] || []
          for (const h of handlers) {
            h(...args)
          }
        },
        signal: vi.fn(),
        destroy: vi.fn(() => {
          peer.destroyed = true
        }),
      }

      mockPeerInstances.push(peer)
      return peer
    })

    mockSetSignalingPresence = vi.fn()
    // Create a minimal mock MediaStream
    mockLocalStream = {
      getTracks: () => [],
      getAudioTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("initialization", () => {
    it("returns empty maps initially", () => {
      const { result } = renderHook(() =>
        useWebRtcMesh(myPeerId, null, [], {}, mockSetSignalingPresence),
      )

      expect(result.current.remoteStreams.size).toBe(0)
      expect(result.current.connectionStates.size).toBe(0)
      expect(Object.keys(result.current.outgoingSignals)).toHaveLength(0)
    })

    it("does not create peers when participant list is empty", () => {
      renderHook(() =>
        useWebRtcMesh(
          myPeerId,
          mockLocalStream,
          [],
          {},
          mockSetSignalingPresence,
        ),
      )

      expect(mockPeerInstances).toHaveLength(0)
    })
  })

  describe("initiator determination", () => {
    it("creates peer as initiator when myPeerId is smaller", async () => {
      const smallerPeerId = "100000000000000000000000000000" as PeerID
      const largerPeerId = "200000000000000000000000000000" as PeerID

      renderHook(() =>
        useWebRtcMesh(
          smallerPeerId,
          mockLocalStream,
          [smallerPeerId, largerPeerId],
          {},
          mockSetSignalingPresence,
        ),
      )

      // Should create peer with initiator: true
      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })
      expect(mockPeerInstances[0].initiator).toBe(true)
    })

    it("does not create peer as initiator when myPeerId is larger", () => {
      const smallerPeerId = "100000000000000000000000000000" as PeerID
      const largerPeerId = "200000000000000000000000000000" as PeerID

      renderHook(() =>
        useWebRtcMesh(
          largerPeerId,
          mockLocalStream,
          [smallerPeerId, largerPeerId],
          {},
          mockSetSignalingPresence,
        ),
      )

      // Should NOT create peer (waits for signal from smaller peer)
      expect(mockPeerInstances).toHaveLength(0)
    })
  })

  describe("signal processing", () => {
    it("processes incoming signals and creates peer if needed", async () => {
      const incomingSignal = { type: "offer", sdp: "test-sdp" }
      // SignalingPresence now only contains signals (no user metadata)
      const signalingPresence: Record<string, SignalingPresence> = {
        [remotePeerId]: {
          signals: {
            [myPeerId]: [incomingSignal],
          },
        },
      }

      renderHook(() =>
        useWebRtcMesh(
          myPeerId,
          mockLocalStream,
          [myPeerId, remotePeerId],
          signalingPresence,
          mockSetSignalingPresence,
        ),
      )

      // Should create peer to handle incoming signal
      await waitFor(() => {
        expect(mockPeerInstances.length).toBeGreaterThan(0)
      })

      // Signal should be passed to the peer
      expect(mockPeerInstances[0].signal).toHaveBeenCalledWith(incomingSignal)
    })

    it("deduplicates signals - same signal not processed twice", async () => {
      const incomingSignal = { type: "offer", sdp: "test-sdp" }
      const signalingPresence: Record<string, SignalingPresence> = {
        [remotePeerId]: {
          signals: {
            [myPeerId]: [incomingSignal],
          },
        },
      }

      const { rerender } = renderHook(
        ({ presence }: { presence: Record<string, SignalingPresence> }) =>
          useWebRtcMesh(
            myPeerId,
            mockLocalStream,
            [myPeerId, remotePeerId],
            presence,
            mockSetSignalingPresence,
          ),
        { initialProps: { presence: signalingPresence } },
      )

      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      const signalCallCount = mockPeerInstances[0].signal.mock.calls.length
      expect(signalCallCount).toBe(1)

      // Rerender with same presence (simulating presence update)
      rerender({ presence: signalingPresence })

      // Signal should not be called again
      expect(mockPeerInstances[0].signal.mock.calls.length).toBe(
        signalCallCount,
      )
    })
  })

  describe("outgoing signals", () => {
    it("publishes signals to presence when peer emits signal event", async () => {
      const { result } = renderHook(() =>
        useWebRtcMesh(
          "100000000000000000000000000000" as PeerID,
          mockLocalStream,
          [
            "100000000000000000000000000000" as PeerID,
            "200000000000000000000000000000" as PeerID,
          ],
          {},
          mockSetSignalingPresence,
        ),
      )

      // Wait for peer to be created
      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      // Simulate peer emitting a signal
      act(() => {
        mockPeerInstances[0].emit("signal", {
          type: "offer",
          sdp: "test-offer",
        })
      })

      // Check that outgoing signals were updated
      await waitFor(() => {
        expect(
          Object.keys(result.current.outgoingSignals).length,
        ).toBeGreaterThan(0)
      })
    })
  })

  describe("connection states", () => {
    it("sets state to connecting when peer is created", async () => {
      const { result } = renderHook(() =>
        useWebRtcMesh(
          "100000000000000000000000000000" as PeerID,
          mockLocalStream,
          [
            "100000000000000000000000000000" as PeerID,
            "200000000000000000000000000000" as PeerID,
          ],
          {},
          mockSetSignalingPresence,
        ),
      )

      await waitFor(() => {
        expect(
          result.current.connectionStates.get(
            "200000000000000000000000000000" as PeerID,
          ),
        ).toBe("connecting")
      })
    })

    it("sets state to connected when peer emits connect event", async () => {
      const { result } = renderHook(() =>
        useWebRtcMesh(
          "100000000000000000000000000000" as PeerID,
          mockLocalStream,
          [
            "100000000000000000000000000000" as PeerID,
            "200000000000000000000000000000" as PeerID,
          ],
          {},
          mockSetSignalingPresence,
        ),
      )

      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      act(() => {
        mockPeerInstances[0].emit("connect")
      })

      await waitFor(() => {
        expect(
          result.current.connectionStates.get(
            "200000000000000000000000000000" as PeerID,
          ),
        ).toBe("connected")
      })
    })

    it("sets state to failed when peer emits error event", async () => {
      // Suppress expected console.error from the error handler
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {})

      const { result } = renderHook(() =>
        useWebRtcMesh(
          "100000000000000000000000000000" as PeerID,
          mockLocalStream,
          [
            "100000000000000000000000000000" as PeerID,
            "200000000000000000000000000000" as PeerID,
          ],
          {},
          mockSetSignalingPresence,
        ),
      )

      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      act(() => {
        mockPeerInstances[0].emit("error", new Error("Connection failed"))
      })

      await waitFor(() => {
        expect(
          result.current.connectionStates.get(
            "200000000000000000000000000000" as PeerID,
          ),
        ).toBe("failed")
      })

      // Restore console.error
      consoleErrorSpy.mockRestore()
    })
  })

  describe("remote streams", () => {
    it("stores remote stream when peer emits stream event", async () => {
      const { result } = renderHook(() =>
        useWebRtcMesh(
          "100000000000000000000000000000" as PeerID,
          mockLocalStream,
          [
            "100000000000000000000000000000" as PeerID,
            "200000000000000000000000000000" as PeerID,
          ],
          {},
          mockSetSignalingPresence,
        ),
      )

      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      const mockRemoteStream = { id: "remote-stream" } as unknown as MediaStream

      act(() => {
        mockPeerInstances[0].emit("stream", mockRemoteStream)
      })

      await waitFor(() => {
        expect(
          result.current.remoteStreams.get(
            "200000000000000000000000000000" as PeerID,
          ),
        ).toBe(mockRemoteStream)
      })
    })
  })

  describe("peer cleanup", () => {
    it("cleans up peer when participant leaves", async () => {
      const { result, rerender } = renderHook(
        ({ participants }: { participants: PeerID[] }) =>
          useWebRtcMesh(
            "100000000000000000000000000000" as PeerID,
            mockLocalStream,
            participants,
            {},
            mockSetSignalingPresence,
          ),
        {
          initialProps: {
            participants: [
              "100000000000000000000000000000" as PeerID,
              "200000000000000000000000000000" as PeerID,
            ],
          },
        },
      )

      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      // Remove the remote participant
      rerender({
        participants: ["100000000000000000000000000000" as PeerID],
      })

      // Peer should be destroyed
      await waitFor(() => {
        expect(mockPeerInstances[0].destroy).toHaveBeenCalled()
      })

      // Connection state should be cleared
      await waitFor(() => {
        expect(
          result.current.connectionStates.has(
            "200000000000000000000000000000" as PeerID,
          ),
        ).toBe(false)
      })
    })

    it("cleans up all peers on unmount", async () => {
      const { unmount } = renderHook(() =>
        useWebRtcMesh(
          "100000000000000000000000000000" as PeerID,
          mockLocalStream,
          [
            "100000000000000000000000000000" as PeerID,
            "200000000000000000000000000000" as PeerID,
          ],
          {},
          mockSetSignalingPresence,
        ),
      )

      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })

      unmount()

      expect(mockPeerInstances[0].destroy).toHaveBeenCalled()
    })
  })

  describe("local stream requirement", () => {
    it("does not create initiator peer without local stream", () => {
      renderHook(() =>
        useWebRtcMesh(
          "100000000000000000000000000000" as PeerID,
          null, // No local stream
          [
            "100000000000000000000000000000" as PeerID,
            "200000000000000000000000000000" as PeerID,
          ],
          {},
          mockSetSignalingPresence,
        ),
      )

      // Should not create peer without local stream
      expect(mockPeerInstances).toHaveLength(0)
    })

    it("creates initiator peer once local stream is available", async () => {
      const { rerender } = renderHook(
        ({ stream }: { stream: MediaStream | null }) =>
          useWebRtcMesh(
            "100000000000000000000000000000" as PeerID,
            stream,
            [
              "100000000000000000000000000000" as PeerID,
              "200000000000000000000000000000" as PeerID,
            ],
            {},
            mockSetSignalingPresence,
          ),
        { initialProps: { stream: null as MediaStream | null } },
      )

      // No peer created yet
      expect(mockPeerInstances).toHaveLength(0)

      // Provide local stream
      rerender({ stream: mockLocalStream })

      // Now peer should be created
      await waitFor(() => {
        expect(mockPeerInstances.length).toBe(1)
      })
    })
  })
})
