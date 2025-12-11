import type { PeerID } from "@loro-extended/repo"
import { useEffect, useRef } from "react"
import type { UserPresence } from "../../shared/types"

/**
 * Timeout in milliseconds before removing a participant whose presence has disappeared.
 * This gives time for temporary network issues to resolve.
 */
const CLEANUP_TIMEOUT_MS = 30_000 // 30 seconds

type Participant = {
  peerId: string
  name: string
  joinedAt: number
}

/**
 * Hook to clean up stale participants based on presence.
 *
 * When a peer's presence disappears (they disconnected), we wait 30s
 * then remove them from the participant list. This handles:
 * - Network disconnections
 * - Browser crashes
 * - Any case where beforeunload didn't fire
 *
 * IMPORTANT: Only cleans up if WE are still connected to the server.
 * If we're offline, we don't know if they're really gone.
 */
export function useParticipantCleanup(
  participants: readonly Participant[],
  userPresence: Record<string, UserPresence>,
  myPeerId: PeerID,
  isOnline: boolean,
  removeParticipant: (peerId: string) => void,
) {
  // Track pending cleanup timers
  const cleanupTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  )

  // Track when we last saw each peer's presence
  const lastSeenRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const now = Date.now()
    const presentPeerIds = new Set(Object.keys(userPresence))
    const participantPeerIds = participants.map(p => p.peerId)

    // Update last seen time for peers with presence
    for (const peerId of presentPeerIds) {
      lastSeenRef.current.set(peerId, now)

      // Cancel any pending cleanup for this peer (they're back!)
      const existingTimer = cleanupTimersRef.current.get(peerId)
      if (existingTimer) {
        clearTimeout(existingTimer)
        cleanupTimersRef.current.delete(peerId)
      }
    }

    // Check for participants whose presence has disappeared
    for (const peerId of participantPeerIds) {
      // Skip self
      if (peerId === myPeerId) {
        continue
      }

      // Skip if presence is still visible
      if (presentPeerIds.has(peerId)) {
        continue
      }

      // Skip if we're offline (we can't know their true state)
      if (!isOnline) {
        continue
      }

      // Skip if we already have a cleanup timer for this peer
      if (cleanupTimersRef.current.has(peerId)) {
        continue
      }

      // Start cleanup timer
      const timer = setTimeout(() => {
        // Double-check they're still gone before removing
        // (presence might have come back in the meantime)
        cleanupTimersRef.current.delete(peerId)
        removeParticipant(peerId)
      }, CLEANUP_TIMEOUT_MS)

      cleanupTimersRef.current.set(peerId, timer)
    }

    // Cleanup timers for peers who are no longer participants
    // (they were already removed by someone else)
    for (const [peerId, timer] of cleanupTimersRef.current) {
      if (!participantPeerIds.includes(peerId)) {
        clearTimeout(timer)
        cleanupTimersRef.current.delete(peerId)
      }
    }
  }, [participants, userPresence, myPeerId, isOnline, removeParticipant])

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of cleanupTimersRef.current.values()) {
        clearTimeout(timer)
      }
      cleanupTimersRef.current.clear()
    }
  }, [])
}
