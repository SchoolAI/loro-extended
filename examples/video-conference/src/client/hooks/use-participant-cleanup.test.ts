import type { PeerID } from "@loro-extended/repo"
import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UserPresence } from "../../shared/types"
import { useParticipantCleanup } from "./use-participant-cleanup"

describe("useParticipantCleanup", () => {
  const myPeerId = "100000000000000000000000000000" as PeerID
  const peer1 = "200000000000000000000000000000" as PeerID
  const peer2 = "300000000000000000000000000000" as PeerID

  type Participant = {
    peerId: string
    name: string
    joinedAt: number
  }

  const defaultParticipants: Participant[] = [
    { peerId: myPeerId, name: "Me", joinedAt: 1000 },
    { peerId: peer1, name: "Alice", joinedAt: 2000 },
    { peerId: peer2, name: "Bob", joinedAt: 3000 },
  ]

  const defaultUserPresence: Record<string, UserPresence> = {
    [myPeerId]: { name: "Me", wantsAudio: true, wantsVideo: true },
    [peer1]: { name: "Alice", wantsAudio: true, wantsVideo: true },
    [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
  }

  let mockRemoveParticipant: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    mockRemoveParticipant = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("does not remove participants when all have presence", () => {
    renderHook(() =>
      useParticipantCleanup(
        defaultParticipants,
        defaultUserPresence,
        myPeerId,
        true, // isOnline
        mockRemoveParticipant,
      ),
    )

    // Fast-forward past cleanup timeout
    vi.advanceTimersByTime(35000)

    expect(mockRemoveParticipant).not.toHaveBeenCalled()
  })

  it("removes participant after 30s when their presence disappears", () => {
    // peer1 has no presence
    const userPresence: Record<string, UserPresence> = {
      [myPeerId]: { name: "Me", wantsAudio: true, wantsVideo: true },
      [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
    }

    renderHook(() =>
      useParticipantCleanup(
        defaultParticipants,
        userPresence,
        myPeerId,
        true, // isOnline
        mockRemoveParticipant,
      ),
    )

    // Should not be called immediately
    expect(mockRemoveParticipant).not.toHaveBeenCalled()

    // Should not be called before 30s
    vi.advanceTimersByTime(29000)
    expect(mockRemoveParticipant).not.toHaveBeenCalled()

    // Should be called after 30s
    vi.advanceTimersByTime(2000)
    expect(mockRemoveParticipant).toHaveBeenCalledWith(peer1)
    expect(mockRemoveParticipant).toHaveBeenCalledTimes(1)
  })

  it("does not remove self even if self presence is missing", () => {
    // Only peer1 and peer2 have presence (self is missing)
    const userPresence: Record<string, UserPresence> = {
      [peer1]: { name: "Alice", wantsAudio: true, wantsVideo: true },
      [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
    }

    renderHook(() =>
      useParticipantCleanup(
        defaultParticipants,
        userPresence,
        myPeerId,
        true, // isOnline
        mockRemoveParticipant,
      ),
    )

    vi.advanceTimersByTime(35000)

    expect(mockRemoveParticipant).not.toHaveBeenCalled()
  })

  it("does not remove participants when we are offline", () => {
    // peer1 has no presence
    const userPresence: Record<string, UserPresence> = {
      [myPeerId]: { name: "Me", wantsAudio: true, wantsVideo: true },
      [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
    }

    renderHook(() =>
      useParticipantCleanup(
        defaultParticipants,
        userPresence,
        myPeerId,
        false, // isOnline = false
        mockRemoveParticipant,
      ),
    )

    vi.advanceTimersByTime(35000)

    // Should not remove anyone when we're offline
    expect(mockRemoveParticipant).not.toHaveBeenCalled()
  })

  it("cancels cleanup timer when presence reappears", () => {
    // Start with peer1 missing
    const userPresenceWithoutPeer1: Record<string, UserPresence> = {
      [myPeerId]: { name: "Me", wantsAudio: true, wantsVideo: true },
      [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
    }

    const { rerender } = renderHook(
      ({ presence }: { presence: Record<string, UserPresence> }) =>
        useParticipantCleanup(
          defaultParticipants,
          presence,
          myPeerId,
          true,
          mockRemoveParticipant,
        ),
      { initialProps: { presence: userPresenceWithoutPeer1 } },
    )

    // Advance 15s (halfway to cleanup)
    vi.advanceTimersByTime(15000)
    expect(mockRemoveParticipant).not.toHaveBeenCalled()

    // peer1's presence comes back
    rerender({ presence: defaultUserPresence })

    // Advance past the original cleanup time
    vi.advanceTimersByTime(20000)

    // Should not have been called because presence came back
    expect(mockRemoveParticipant).not.toHaveBeenCalled()
  })

  it("removes multiple participants whose presence disappears", () => {
    // Only self has presence
    const userPresence: Record<string, UserPresence> = {
      [myPeerId]: { name: "Me", wantsAudio: true, wantsVideo: true },
    }

    renderHook(() =>
      useParticipantCleanup(
        defaultParticipants,
        userPresence,
        myPeerId,
        true,
        mockRemoveParticipant,
      ),
    )

    vi.advanceTimersByTime(35000)

    expect(mockRemoveParticipant).toHaveBeenCalledWith(peer1)
    expect(mockRemoveParticipant).toHaveBeenCalledWith(peer2)
    expect(mockRemoveParticipant).toHaveBeenCalledTimes(2)
  })

  it("cleans up timers on unmount", () => {
    // peer1 has no presence
    const userPresence: Record<string, UserPresence> = {
      [myPeerId]: { name: "Me", wantsAudio: true, wantsVideo: true },
      [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
    }

    const { unmount } = renderHook(() =>
      useParticipantCleanup(
        defaultParticipants,
        userPresence,
        myPeerId,
        true,
        mockRemoveParticipant,
      ),
    )

    // Advance 15s (timer is pending)
    vi.advanceTimersByTime(15000)

    // Unmount
    unmount()

    // Advance past cleanup time
    vi.advanceTimersByTime(20000)

    // Should not have been called because component unmounted
    expect(mockRemoveParticipant).not.toHaveBeenCalled()
  })

  it("does not start new timer for participant already being cleaned up", () => {
    // peer1 has no presence
    const userPresence: Record<string, UserPresence> = {
      [myPeerId]: { name: "Me", wantsAudio: true, wantsVideo: true },
      [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
    }

    const { rerender } = renderHook(
      ({ presence }: { presence: Record<string, UserPresence> }) =>
        useParticipantCleanup(
          defaultParticipants,
          presence,
          myPeerId,
          true,
          mockRemoveParticipant,
        ),
      { initialProps: { presence: userPresence } },
    )

    // Advance 15s
    vi.advanceTimersByTime(15000)

    // Rerender with same presence (simulating presence update)
    rerender({ presence: userPresence })

    // Advance another 20s (total 35s from start)
    vi.advanceTimersByTime(20000)

    // Should only be called once (not twice)
    expect(mockRemoveParticipant).toHaveBeenCalledTimes(1)
  })
})
