import type { WebRtcDataChannelAdapter } from "@loro-extended/adapter-webrtc"
import { useDocIdFromHash } from "@loro-extended/react"
import { type DocId, generateUUID } from "@loro-extended/repo"
import { useCallback, useEffect, useMemo, useState } from "react"
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
  useRoom,
} from "./hooks"
import { useLocalMedia } from "./use-local-media"
import { useWebRtcMesh } from "./use-webrtc-mesh"

// Generate a new room ID
function generateRoomId(): DocId {
  return `room-${generateUUID()}`
}

type VideoConferenceAppProps = {
  displayName: string
  webrtcAdapter: WebRtcDataChannelAdapter
}

export default function VideoConferenceApp({
  displayName,
  webrtcAdapter,
}: VideoConferenceAppProps) {
  const [isCopied, setIsCopied] = useState(false)

  // Get room ID from URL hash, or create new room
  const roomId = useDocIdFromHash(generateRoomId)

  // Room state, presence, and actions (consolidated hook)
  const {
    myPeerId,
    participants,
    participantPeerIds,
    userPresence,
    signalingPresence,
    setSignalingPresence,
    setUserPresence,
    joinRoom: joinRoomAction,
    leaveRoom,
    removeParticipant,
  } = useRoom(roomId)

  // Derive hasJoined from document state (single source of truth)
  const hasJoined = useMemo(
    () => participants.some(p => p.peerId === myPeerId),
    [participants, myPeerId],
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

  // WebRTC mesh for video connections
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
  useEffect(() => {
    setUserPresence({
      name: displayName,
      wantsAudio: wantsAudio,
      wantsVideo: wantsVideo,
    })
  }, [displayName, wantsAudio, wantsVideo, setUserPresence])

  // Join room
  const joinRoom = useCallback(() => {
    joinRoomAction(displayName)
  }, [joinRoomAction, displayName])

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
    // hasJoined is derived from document state, so it will naturally
    // become false when the room changes (new room has no participants)
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
