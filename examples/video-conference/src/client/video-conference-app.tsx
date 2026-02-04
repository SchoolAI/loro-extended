import type { WebRtcDataChannelAdapter } from "@loro-extended/adapter-webrtc"
import {
  change,
  Shape,
  useDoc,
  useEphemeral,
  useHandle,
  useRepo,
} from "@loro-extended/react"
import { type DocId, generateUUID, type PeerID } from "@loro-extended/repo"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  RoomSchema,
  SignalingEphemeralDeclarations,
  type SignalingPresence,
  UserEphemeralDeclarations,
  type UserPresence,
} from "../shared/types"
import {
  DebugPanel,
  Header,
  InCallScreen,
  OfflineBanner,
  PreJoinScreen,
} from "./components"
import {
  useConnectionStatus,
  useDebugInfo,
  useParticipantCleanup,
} from "./hooks"
import { useLocalMedia } from "./use-local-media"
import { useRoomIdFromHash } from "./use-room-id-from-hash"
import { useWebRtcMesh } from "./use-webrtc-mesh"

// Generate a new room ID
function generateRoomId(): DocId {
  return `room-${generateUUID()}`
}

// Empty doc schema for signaling channel (we only use presence)
const SignalingDocSchema = Shape.doc({})

type VideoConferenceAppProps = {
  displayName: string
  webrtcAdapter: WebRtcDataChannelAdapter
}

export default function VideoConferenceApp({
  displayName,
  webrtcAdapter,
}: VideoConferenceAppProps) {
  const repo = useRepo()
  const myPeerId = repo.identity.peerId
  const [isCopied, setIsCopied] = useState(false)
  const [hasJoined, setHasJoined] = useState(false)

  // Get room ID from URL hash, or create new room
  const roomId = useRoomIdFromHash(generateRoomId())

  // Track previous room ID to detect changes
  const prevRoomIdRef = useRef<DocId>(roomId)

  // Handle room changes - reset state when switching rooms
  useEffect(() => {
    if (prevRoomIdRef.current !== roomId) {
      setHasJoined(false)
      prevRoomIdRef.current = roomId
    }
  }, [roomId])

  // Ensure hash is set if it was empty (first load)
  useEffect(() => {
    if (!window.location.hash.slice(1)) {
      window.location.hash = roomId
    }
  }, [roomId])

  // NEW API: Get handle with doc and ephemeral schemas
  const handle = useHandle(roomId, RoomSchema, UserEphemeralDeclarations)
  const doc = useDoc(handle)
  const { self: userSelf, peers: userPeers } = useEphemeral(handle.presence)

  // Convert to the old format for backward compatibility with existing code
  const userPresence: Record<string, UserPresence> = {}
  if (userSelf) {
    userPresence[myPeerId] = userSelf
  }
  for (const [peerId, presence] of userPeers.entries()) {
    userPresence[peerId] = presence
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: debug logging
  useEffect(() => {
    console.log({ userPresence })
  }, [userPresence])

  // ============================================================================
  // Signaling Presence Channel (separate from user presence)
  // ============================================================================

  // Signaling presence - high-frequency WebRTC signals
  // Uses a separate channel to avoid mixing with user metadata
  const signalingChannelId = `${roomId}:signaling` as DocId
  const signalingHandle = useHandle(
    signalingChannelId,
    SignalingDocSchema,
    SignalingEphemeralDeclarations,
  )
  const { self: signalingSelf, peers: signalingPeers } = useEphemeral(
    signalingHandle.presence,
  )

  // Convert to the old format for backward compatibility
  const signalingPresence: Record<string, SignalingPresence> = {}
  if (signalingSelf) {
    signalingPresence[myPeerId] = signalingSelf
  }
  for (const [peerId, presence] of signalingPeers.entries()) {
    signalingPresence[peerId] = presence
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: debug logging
  useEffect(() => {
    console.log({ signalingPresence })
  }, [signalingPresence])

  // Wrapper for setSignalingPresence to match old API
  const setSignalingPresence = useCallback(
    (value: Partial<SignalingPresence>) => {
      signalingHandle.presence.setSelf(value as SignalingPresence)
    },
    [signalingHandle],
  )

  // Local media (camera/microphone)
  const {
    stream: localStream,
    error: mediaError,
    isLoading: mediaLoading,
    isMediaReady,
    wantsAudio,
    wantsVideo,
    hasAudio,
    hasVideo,
    toggleAudio,
    toggleVideo,
    requestMedia,
    deviceSelection,
    audioLevel,
  } = useLocalMedia(true, true)

  // Get participant peer IDs from the document
  // doc.participants is already a plain array (useDoc returns JSON)
  const participants = doc.participants
  const participantPeerIds = participants.map(p => p.peerId as PeerID)

  // WebRTC mesh for video connections - only needs signaling presence
  // Also connects Loro sync via data channels
  const { remoteStreams, connectionStates, outgoingSignals, instanceId } =
    useWebRtcMesh(
      myPeerId,
      localStream,
      participantPeerIds,
      signalingPresence,
      setSignalingPresence,
      webrtcAdapter,
    )

  // Debug info for the debug panel
  const { debugInfo, refresh: refreshDebugInfo } = useDebugInfo({
    userPresence,
    signalingPresence,
    connectionStates,
    instanceId,
    outgoingSignals,
  })

  // Update user presence with media preferences
  // Use wantsAudio/wantsVideo (user preferences) not hasAudio/hasVideo (actual track state)
  useEffect(() => {
    handle.presence.setSelf({
      name: displayName,
      wantsAudio: wantsAudio,
      wantsVideo: wantsVideo,
    })
  }, [displayName, wantsAudio, wantsVideo, handle])

  // Join room
  const joinRoom = useCallback(() => {
    const alreadyJoined = participants.some(p => p.peerId === myPeerId)
    if (!alreadyJoined) {
      change(handle.doc, draft => {
        draft.participants.push({
          peerId: myPeerId,
          name: displayName,
          joinedAt: Date.now(),
        })
      })
    }
    setHasJoined(true)
  }, [participants, myPeerId, displayName, handle])

  // Leave room
  const leaveRoom = useCallback(() => {
    change(handle.doc, draft => {
      const index = draft.participants.findIndex(p => p.peerId === myPeerId)
      if (index !== -1) {
        draft.participants.delete(index, 1)
      }
    })
    setHasJoined(false)
  }, [myPeerId, handle])

  // Remove a participant from the document (used by cleanup hook)
  const removeParticipant = useCallback(
    (peerId: string) => {
      change(handle.doc, draft => {
        const index = draft.participants.findIndex(p => p.peerId === peerId)
        if (index !== -1) {
          draft.participants.delete(index, 1)
        }
      })
    },
    [handle],
  )

  // Connection status monitoring
  const { isOnline, getPeerStatus } = useConnectionStatus(
    userPresence,
    connectionStates,
    participantPeerIds,
    myPeerId,
  )

  // Automatic cleanup of stale participants
  useParticipantCleanup(
    participants,
    userPresence,
    myPeerId,
    isOnline,
    removeParticipant,
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hasJoined) {
        removeParticipant(myPeerId)
      }
    }
  }, [hasJoined, myPeerId, removeParticipant])

  // Cleanup on beforeunload (browser close, navigation)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (hasJoined) {
        // Use synchronous approach for beforeunload
        // The changeDoc will be queued but may not complete
        // The presence-based cleanup will handle it if this fails
        removeParticipant(myPeerId)
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [hasJoined, myPeerId, removeParticipant])

  const startNewRoom = useCallback(() => {
    const newId = generateRoomId()
    window.location.hash = newId
    setHasJoined(false)
  }, [])

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }, [])

  // Get other participants (excluding self)
  const otherParticipants = participants.filter(p => p.peerId !== myPeerId)

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Offline banner */}
      {!isOnline && <OfflineBanner />}

      <Header
        roomId={roomId}
        participantCount={participants.length}
        isCopied={isCopied}
        onCopyLink={copyLink}
        onNewRoom={startNewRoom}
      />

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          {!hasJoined && (
            <PreJoinScreen
              localStream={localStream}
              displayName={displayName}
              hasAudio={wantsAudio}
              hasVideo={wantsVideo}
              mediaError={mediaError}
              mediaLoading={mediaLoading}
              onToggleAudio={toggleAudio}
              onToggleVideo={toggleVideo}
              onRequestMedia={requestMedia}
              onJoin={joinRoom}
              canJoin={isMediaReady}
              deviceSelection={deviceSelection}
              audioLevel={audioLevel}
            />
          )}

          {hasJoined && (
            <InCallScreen
              localStream={localStream}
              displayName={displayName}
              hasAudio={hasAudio}
              hasVideo={hasVideo}
              otherParticipants={otherParticipants}
              remoteStreams={remoteStreams}
              connectionStates={connectionStates}
              userPresence={userPresence}
              getPeerStatus={getPeerStatus}
              onToggleAudio={toggleAudio}
              onToggleVideo={toggleVideo}
              onLeave={leaveRoom}
            />
          )}
        </div>
      </main>

      {/* Debug Panel */}
      <DebugPanel debugInfo={debugInfo} onRefresh={refreshDebugInfo} />
    </div>
  )
}
