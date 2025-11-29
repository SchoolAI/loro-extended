import { useDocument, useUntypedPresence, useRepo } from "@loro-extended/react"
import type { DocId, PeerID } from "@loro-extended/repo"
import { useCallback, useEffect, useState } from "react"
import {
  EmptyRoom,
  RoomSchema,
  type UserPresence,
  type SignalingPresence,
} from "../shared/types"
import { useLocalMedia } from "./use-local-media"
import { useRoomIdFromHash } from "./use-room-id-from-hash"
import { useWebRtcMesh } from "./use-webrtc-mesh"
import { Header, PreJoinScreen, InCallScreen } from "./components"

// Generate a new room ID
function generateRoomId(): DocId {
  return `room-${crypto.randomUUID()}`
}

type VideoConferenceAppProps = {
  displayName: string
}

export default function VideoConferenceApp({
  displayName,
}: VideoConferenceAppProps) {
  const repo = useRepo()
  const myPeerId = repo.identity.peerId
  const [isCopied, setIsCopied] = useState(false)
  const [hasJoined, setHasJoined] = useState(false)

  // Get room ID from URL hash, or create new room
  const roomId = useRoomIdFromHash(generateRoomId())

  // Ensure hash is set if it was empty (first load)
  useEffect(() => {
    if (!window.location.hash.slice(1)) {
      window.location.hash = roomId
    }
  }, [roomId])

  // Use room document for persistent state
  const [doc, changeDoc, handle] = useDocument(roomId, RoomSchema, EmptyRoom)

  // ============================================================================
  // Separated Presence Channels (Phase 3)
  // ============================================================================
  
  // User presence - stable metadata (name, audio/video preferences)
  // Uses the main room ID as the presence channel
  const { all: rawUserPresence, setSelf: setUserPresence } = useUntypedPresence(roomId)
  const userPresence = rawUserPresence as Record<string, UserPresence>
  
  // Signaling presence - high-frequency WebRTC signals
  // Uses a separate channel to avoid mixing with user metadata
  const signalingChannelId = `${roomId}:signaling` as DocId
  const { all: rawSignalingPresence, setSelf: setSignalingPresence } = useUntypedPresence(signalingChannelId)
  const signalingPresence = rawSignalingPresence as Record<string, SignalingPresence>

  // Local media (camera/microphone)
  const {
    stream: localStream,
    error: mediaError,
    isLoading: mediaLoading,
    hasAudio,
    hasVideo,
    toggleAudio,
    toggleVideo,
    requestMedia,
  } = useLocalMedia(true, true)

  // Get participant peer IDs from the document
  const participantPeerIds = doc.participants.map(p => p.peerId as PeerID)

  // WebRTC mesh for video connections - only needs signaling presence
  const { remoteStreams, connectionStates } = useWebRtcMesh(
    myPeerId,
    localStream,
    participantPeerIds,
    signalingPresence,
    setSignalingPresence,
  )

  // Update user presence with media preferences
  useEffect(() => {
    setUserPresence({
      name: displayName,
      wantsAudio: hasAudio,
      wantsVideo: hasVideo,
    })
  }, [displayName, hasAudio, hasVideo, setUserPresence])

  // Join room
  const joinRoom = useCallback(() => {
    const alreadyJoined = doc.participants.some(p => p.peerId === myPeerId)
    if (!alreadyJoined) {
      changeDoc(draft => {
        draft.participants.push({
          peerId: myPeerId,
          name: displayName,
          joinedAt: Date.now(),
        })
      })
    }
    setHasJoined(true)
  }, [doc.participants, myPeerId, displayName, changeDoc])

  // Leave room
  const leaveRoom = useCallback(() => {
    changeDoc(draft => {
      const index = draft.participants.findIndex(p => p.peerId === myPeerId)
      if (index !== -1) {
        draft.participants.delete(index, 1)
      }
    })
    setHasJoined(false)
  }, [myPeerId, changeDoc])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hasJoined) {
        changeDoc(draft => {
          const index = draft.participants.findIndex(p => p.peerId === myPeerId)
          if (index !== -1) {
            draft.participants.delete(index, 1)
          }
        })
      }
    }
  }, [hasJoined, myPeerId, changeDoc])

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
  const otherParticipants = doc.participants.filter(p => p.peerId !== myPeerId)

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <Header
        roomId={roomId}
        participantCount={doc.participants.length}
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
              hasAudio={hasAudio}
              hasVideo={hasVideo}
              mediaError={mediaError}
              mediaLoading={mediaLoading}
              onToggleAudio={toggleAudio}
              onToggleVideo={toggleVideo}
              onRequestMedia={requestMedia}
              onJoin={joinRoom}
              canJoin={!!handle}
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
              onToggleAudio={toggleAudio}
              onToggleVideo={toggleVideo}
              onLeave={leaveRoom}
            />
          )}
        </div>
      </main>
    </div>
  )
}
