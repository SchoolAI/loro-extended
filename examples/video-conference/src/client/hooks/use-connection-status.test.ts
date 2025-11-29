import type { PeerID } from "@loro-extended/repo"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UserPresence } from "../../shared/types"
import { useConnectionStatus } from "./use-connection-status"
import type { ConnectionState } from "./use-peer-manager"

describe("useConnectionStatus", () => {
  const myPeerId = "100000000000000000000000000000" as PeerID
  const peer1 = "200000000000000000000000000000" as PeerID
  const peer2 = "300000000000000000000000000000" as PeerID

  const defaultUserPresence: Record<string, UserPresence> = {
    [peer1]: { name: "Alice", wantsAudio: true, wantsVideo: true },
    [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
  }

  const defaultConnectionStates = new Map<PeerID, ConnectionState>([
    [peer1, "connected"],
    [peer2, "connected"],
  ])

  const defaultParticipants = [myPeerId, peer1, peer2]

  // Mock navigator.onLine
  let originalNavigator: typeof navigator

  beforeEach(() => {
    originalNavigator = global.navigator
    Object.defineProperty(global, "navigator", {
      value: { onLine: true },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
    vi.clearAllMocks()
  })

  describe("isOnline", () => {
    it("returns true when navigator.onLine is true", () => {
      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.isOnline).toBe(true)
    })

    it("returns false when navigator.onLine is false", () => {
      Object.defineProperty(global, "navigator", {
        value: { onLine: false },
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.isOnline).toBe(false)
    })

    it("updates when online event fires", () => {
      Object.defineProperty(global, "navigator", {
        value: { onLine: false },
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.isOnline).toBe(false)

      act(() => {
        window.dispatchEvent(new Event("online"))
      })

      expect(result.current.isOnline).toBe(true)
    })

    it("updates when offline event fires", () => {
      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.isOnline).toBe(true)

      act(() => {
        window.dispatchEvent(new Event("offline"))
      })

      expect(result.current.isOnline).toBe(false)
    })
  })

  describe("getPeerStatus", () => {
    it("returns 'connected' for peers with presence and connected WebRTC", () => {
      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.getPeerStatus(peer1)).toBe("connected")
      expect(result.current.getPeerStatus(peer2)).toBe("connected")
    })

    it("returns 'reconnecting' for peers with presence but failing WebRTC", () => {
      const connectionStates = new Map<PeerID, ConnectionState>([
        [peer1, "connecting"],
        [peer2, "failed"],
      ])

      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          connectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.getPeerStatus(peer1)).toBe("reconnecting")
      expect(result.current.getPeerStatus(peer2)).toBe("reconnecting")
    })

    it("returns 'peer-disconnected' for peers without presence when we're online", () => {
      // peer1 has no presence
      const userPresence: Record<string, UserPresence> = {
        [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
      }

      const { result } = renderHook(() =>
        useConnectionStatus(
          userPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.getPeerStatus(peer1)).toBe("peer-disconnected")
      expect(result.current.getPeerStatus(peer2)).toBe("connected")
    })

    it("returns 'self-disconnected' for all peers when we're offline", () => {
      Object.defineProperty(global, "navigator", {
        value: { onLine: false },
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.getPeerStatus(peer1)).toBe("self-disconnected")
      expect(result.current.getPeerStatus(peer2)).toBe("self-disconnected")
    })
  })

  describe("offlinePeers", () => {
    it("returns empty array when all peers have presence", () => {
      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.offlinePeers).toEqual([])
    })

    it("returns peers without presence", () => {
      // Only peer2 has presence
      const userPresence: Record<string, UserPresence> = {
        [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
      }

      const { result } = renderHook(() =>
        useConnectionStatus(
          userPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.offlinePeers).toEqual([peer1])
    })

    it("does not include self in offlinePeers", () => {
      // No one has presence
      const { result } = renderHook(() =>
        useConnectionStatus(
          {},
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.offlinePeers).not.toContain(myPeerId)
      expect(result.current.offlinePeers).toContain(peer1)
      expect(result.current.offlinePeers).toContain(peer2)
    })
  })

  describe("reconnectingPeers", () => {
    it("returns empty array when all peers are connected", () => {
      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          defaultConnectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.reconnectingPeers).toEqual([])
    })

    it("returns peers with presence but failing WebRTC", () => {
      const connectionStates = new Map<PeerID, ConnectionState>([
        [peer1, "connecting"],
        [peer2, "connected"],
      ])

      const { result } = renderHook(() =>
        useConnectionStatus(
          defaultUserPresence,
          connectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      expect(result.current.reconnectingPeers).toEqual([peer1])
    })

    it("does not include peers without presence in reconnectingPeers", () => {
      // peer1 has no presence but has failing WebRTC
      const userPresence: Record<string, UserPresence> = {
        [peer2]: { name: "Bob", wantsAudio: true, wantsVideo: true },
      }
      const connectionStates = new Map<PeerID, ConnectionState>([
        [peer1, "connecting"],
        [peer2, "connected"],
      ])

      const { result } = renderHook(() =>
        useConnectionStatus(
          userPresence,
          connectionStates,
          defaultParticipants,
          myPeerId,
        ),
      )

      // peer1 should be in offlinePeers, not reconnectingPeers
      expect(result.current.reconnectingPeers).toEqual([])
      expect(result.current.offlinePeers).toEqual([peer1])
    })
  })
})
