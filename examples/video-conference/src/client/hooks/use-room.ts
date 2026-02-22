import {
  change,
  type Infer,
  Shape,
  useDocument,
  useEphemeral,
  useRepo,
  useValue,
} from "@loro-extended/react"
import { type DocId, type PeerID, sync } from "@loro-extended/repo"
import { useCallback, useMemo } from "react"
import {
  type Participant,
  RoomSchema,
  SignalingEphemeralDeclarations,
  type SignalingPresence,
  UserEphemeralDeclarations,
  type UserPresence,
} from "../../shared/types"

// Empty doc schema for signaling channel (we only use presence)
const SignalingDocSchema = Shape.doc({})

/**
 * Return type for the useRoom hook.
 */
export type UseRoomReturn = {
  /** Our peer ID */
  myPeerId: PeerID

  /** List of participants in the room */
  participants: Participant[]

  /** Peer IDs of all participants */
  participantPeerIds: PeerID[]

  /** User presence map (peerId -> UserPresence) */
  userPresence: Record<string, UserPresence>

  /** Signaling presence map (peerId -> SignalingPresence) */
  signalingPresence: Record<string, SignalingPresence>

  /** Update signaling presence */
  setSignalingPresence: (value: Partial<SignalingPresence>) => void

  /** Update user presence */
  setUserPresence: (value: Partial<UserPresence>) => void

  /** Join the room (adds self to participants) */
  joinRoom: (displayName: string) => void

  /** Leave the room (removes self from participants) */
  leaveRoom: () => void

  /** Remove a participant by peer ID (for cleanup) */
  removeParticipant: (peerId: string) => void
}

/**
 * Hook to manage room state, signaling, and presence.
 *
 * This hook consolidates:
 * - Room document with participant list
 * - User presence (name, audio/video preferences)
 * - Signaling presence (WebRTC signals)
 *
 * ## Document Model
 *
 * Two documents are used per room:
 * - `{roomId}` - Persistent room document with participant list
 * - `{roomId}:signaling` - Ephemeral signaling document (presence only)
 *
 * ## Presence Types
 *
 * - **UserPresence**: Stable metadata (name, wantsAudio, wantsVideo)
 * - **SignalingPresence**: High-frequency WebRTC signals (offers, answers, ICE candidates)
 *
 * Separating these prevents signal updates from interfering with user metadata.
 *
 * @param roomId - The room document ID
 * @returns Room state, presence, and actions
 */
export function useRoom(roomId: DocId): UseRoomReturn {
  const repo = useRepo()
  const myPeerId = repo.identity.peerId

  // ============================================================================
  // Room Document
  // ============================================================================

  const doc = useDocument(roomId, RoomSchema, UserEphemeralDeclarations)
  const snapshot = useValue(doc) as Infer<typeof RoomSchema>
  const { self: userSelf, peers: userPeers } = useEphemeral(sync(doc).presence)

  // Convert user presence to Record format
  const userPresence = useMemo(() => {
    const result: Record<string, UserPresence> = {}
    if (userSelf) {
      result[myPeerId] = userSelf
    }
    for (const [peerId, presence] of userPeers.entries()) {
      result[peerId] = presence
    }
    return result
  }, [userSelf, userPeers, myPeerId])

  // ============================================================================
  // Signaling Document
  // ============================================================================

  const signalingChannelId = `${roomId}:signaling` as DocId
  const signalingDoc = useDocument(
    signalingChannelId,
    SignalingDocSchema,
    SignalingEphemeralDeclarations,
  )
  const { self: signalingSelf, peers: signalingPeers } = useEphemeral(
    sync(signalingDoc).presence,
  )

  // Convert signaling presence to Record format
  const signalingPresence = useMemo(() => {
    const result: Record<string, SignalingPresence> = {}
    if (signalingSelf) {
      result[myPeerId] = signalingSelf
    }
    for (const [peerId, presence] of signalingPeers.entries()) {
      result[peerId] = presence
    }
    return result
  }, [signalingSelf, signalingPeers, myPeerId])

  // ============================================================================
  // Presence Setters
  // ============================================================================

  const setSignalingPresence = useCallback(
    (value: Partial<SignalingPresence>) => {
      sync(signalingDoc).presence.setSelf(value as SignalingPresence)
    },
    [signalingDoc],
  )

  const setUserPresence = useCallback(
    (value: Partial<UserPresence>) => {
      sync(doc).presence.setSelf(value as UserPresence)
    },
    [doc],
  )

  // ============================================================================
  // Derived State
  // ============================================================================

  const participants = snapshot.participants
  const participantPeerIds = useMemo(
    () => participants.map(p => p.peerId as PeerID),
    [participants],
  )

  // ============================================================================
  // Room Actions
  // ============================================================================

  const joinRoom = useCallback(
    (displayName: string) => {
      const alreadyJoined = participants.some(p => p.peerId === myPeerId)
      if (!alreadyJoined) {
        change(doc, draft => {
          draft.participants.push({
            peerId: myPeerId,
            name: displayName,
            joinedAt: Date.now(),
          })
        })
      }
    },
    [participants, myPeerId, doc],
  )

  const leaveRoom = useCallback(() => {
    change(doc, draft => {
      const index = draft.participants.findIndex(p => p.peerId === myPeerId)
      if (index !== -1) {
        draft.participants.delete(index, 1)
      }
    })
  }, [myPeerId, doc])

  const removeParticipant = useCallback(
    (peerId: string) => {
      change(doc, draft => {
        const index = draft.participants.findIndex(p => p.peerId === peerId)
        if (index !== -1) {
          draft.participants.delete(index, 1)
        }
      })
    },
    [doc],
  )

  return {
    myPeerId,
    participants,
    participantPeerIds,
    userPresence,
    signalingPresence,
    setSignalingPresence,
    setUserPresence,
    joinRoom,
    leaveRoom,
    removeParticipant,
  }
}
