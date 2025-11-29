import type { PeerID } from "@loro-extended/repo"
import { useEffect, useMemo, useState } from "react"
import type { UserPresence } from "../../shared/types"
import type { ConnectionState } from "./use-peer-manager"

/**
 * Connection status for a participant.
 */
export type ParticipantConnectionStatus =
  | "connected" // Everything working
  | "reconnecting" // WebRTC reconnecting, presence still visible
  | "peer-disconnected" // Their presence gone, we're still connected to server
  | "self-disconnected" // We lost server connection

export type UseConnectionStatusReturn = {
  /** Can we reach the server? */
  isOnline: boolean

  /** Get the connection status for a specific peer */
  getPeerStatus: (peerId: PeerID) => ParticipantConnectionStatus

  /** Peers whose presence has disappeared (they appear offline) */
  offlinePeers: PeerID[]

  /** Peers with WebRTC issues but presence still visible */
  reconnectingPeers: PeerID[]
}

/**
 * Hook to monitor connection status for self and peers.
 * 
 * Combines multiple signals to determine whose network is unstable:
 * 1. Server connectivity (via navigator.onLine + custom checks)
 * 2. WebRTC connection state (from usePeerManager)
 * 3. Presence visibility (from useUntypedPresence)
 * 
 * Logic:
 * - If we're offline → self-disconnected for all peers
 * - If peer's presence is gone but we're online → peer-disconnected
 * - If peer's WebRTC is failing but presence visible → reconnecting
 * - Otherwise → connected
 */
export function useConnectionStatus(
  userPresence: Record<string, UserPresence>,
  connectionStates: Map<PeerID, ConnectionState>,
  participantPeerIds: PeerID[],
  myPeerId: PeerID,
): UseConnectionStatusReturn {
  // Track online status using navigator.onLine
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  )

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  // Get peers whose presence has disappeared
  const offlinePeers = useMemo(() => {
    const presentPeerIds = new Set(Object.keys(userPresence))
    return participantPeerIds.filter(
      peerId => peerId !== myPeerId && !presentPeerIds.has(peerId)
    )
  }, [userPresence, participantPeerIds, myPeerId])

  // Get peers with WebRTC issues but presence still visible
  const reconnectingPeers = useMemo(() => {
    const presentPeerIds = new Set(Object.keys(userPresence))
    return participantPeerIds.filter(peerId => {
      if (peerId === myPeerId) return false
      if (!presentPeerIds.has(peerId)) return false // Already offline
      const state = connectionStates.get(peerId)
      return state === "connecting" || state === "failed"
    })
  }, [userPresence, connectionStates, participantPeerIds, myPeerId])

  // Get status for a specific peer
  const getPeerStatus = useMemo(() => {
    return (peerId: PeerID): ParticipantConnectionStatus => {
      // If we're offline, we can't know anyone's true status
      if (!isOnline) {
        return "self-disconnected"
      }

      // Check if peer's presence is visible
      const hasPresence = peerId in userPresence

      if (!hasPresence) {
        return "peer-disconnected"
      }

      // Check WebRTC connection state
      const webrtcState = connectionStates.get(peerId)
      if (webrtcState === "connecting" || webrtcState === "failed") {
        return "reconnecting"
      }

      return "connected"
    }
  }, [isOnline, userPresence, connectionStates])

  return {
    isOnline,
    getPeerStatus,
    offlinePeers,
    reconnectingPeers,
  }
}