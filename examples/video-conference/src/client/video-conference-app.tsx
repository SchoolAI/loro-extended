import { useDocument, useUntypedPresence, useRepo } from "@loro-extended/react"
import type { DocId, PeerID } from "@loro-extended/repo"
import { useEffect, useState } from "react"
import {
  EmptyRoom,
  RoomSchema,
  type SignalingPresence,
} from "../shared/types"
import { useLocalMedia } from "./use-local-media"
import { useRoomIdFromHash } from "./use-room-id-from-hash"
import { useWebRtcMesh } from "./use-webrtc-mesh"
import { VideoBubble } from "./video-bubble"

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

  // Use UNTYPED presence for ephemeral signaling to avoid schema transformation issues
  const { all: rawPresence, setSelf: setSelfPresence } = useUntypedPresence(roomId)
  
  // Cast the raw presence to our expected type
  const allPresence = rawPresence as Record<string, SignalingPresence>

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

  // WebRTC mesh for video connections
  const { remoteStreams, connectionStates } = useWebRtcMesh(
    myPeerId,
    localStream,
    participantPeerIds,
    allPresence as Record<string, SignalingPresence>,
    setSelfPresence,
  )

  // Update presence with media preferences
  useEffect(() => {
    setSelfPresence({
      name: displayName,
      wantsAudio: hasAudio,
      wantsVideo: hasVideo,
    })
  }, [displayName, hasAudio, hasVideo, setSelfPresence])

  // Join room
  const joinRoom = () => {
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
  }

  // Leave room
  const leaveRoom = () => {
    changeDoc(draft => {
      const index = draft.participants.findIndex(p => p.peerId === myPeerId)
      if (index !== -1) {
        draft.participants.delete(index, 1)
      }
    })
    setHasJoined(false)
  }

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

  const startNewRoom = () => {
    const newId = generateRoomId()
    window.location.hash = newId
    setHasJoined(false)
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  // Get other participants (excluding self)
  const otherParticipants = doc.participants.filter(p => p.peerId !== myPeerId)

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-slate-800 text-white shadow-md z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-green-500 p-2 rounded-lg">
              <span className="text-xl">📹</span>
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">
                Video Conference
              </h1>
              <div className="text-xs text-slate-400">
                Room: {roomId.slice(0, 20)}...
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-slate-300 text-sm">
              <span>👥</span>
              <span>{doc.participants.length}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyLink}
                className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-300 hover:text-white"
                title="Copy Link"
              >
                {isCopied ? "✅" : "🔗"}
              </button>
              <button
                type="button"
                onClick={startNewRoom}
                className="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-full text-sm font-medium transition-colors shadow-sm"
              >
                New Room
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          {/* Pre-join screen */}
          {!hasJoined && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
              <h2 className="text-2xl font-bold text-gray-800">
                Ready to join?
              </h2>

              {/* Local video preview */}
              <div className="relative">
                <VideoBubble
                  stream={localStream}
                  label={displayName}
                  muted={true}
                  isLocal={true}
                  hasAudio={hasAudio}
                  hasVideo={hasVideo}
                />
              </div>

              {/* Media error */}
              {mediaError && (
                <div className="bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">
                  Camera/microphone error: {mediaError.message}
                  <button
                    type="button"
                    onClick={requestMedia}
                    className="ml-2 underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Media loading */}
              {mediaLoading && (
                <div className="text-gray-500 text-sm">
                  Requesting camera and microphone...
                </div>
              )}

              {/* Media controls */}
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={toggleAudio}
                  className={`p-3 rounded-full ${
                    hasAudio
                      ? "bg-gray-200 hover:bg-gray-300"
                      : "bg-red-500 text-white hover:bg-red-600"
                  }`}
                  title={hasAudio ? "Mute" : "Unmute"}
                >
                  {hasAudio ? "🎤" : "🔇"}
                </button>
                <button
                  type="button"
                  onClick={toggleVideo}
                  className={`p-3 rounded-full ${
                    hasVideo
                      ? "bg-gray-200 hover:bg-gray-300"
                      : "bg-red-500 text-white hover:bg-red-600"
                  }`}
                  title={hasVideo ? "Turn off camera" : "Turn on camera"}
                >
                  {hasVideo ? "📷" : "📷"}
                </button>
              </div>

              {/* Join button */}
              <button
                type="button"
                onClick={joinRoom}
                disabled={!handle}
                className="bg-green-600 hover:bg-green-500 disabled:bg-gray-300 text-white px-8 py-3 rounded-full text-lg font-medium transition-colors shadow-lg"
              >
                Join Room
              </button>

              <p className="text-gray-500 text-sm">
                Share this link with others to invite them
              </p>
            </div>
          )}

          {/* In-call screen */}
          {hasJoined && (
            <div className="space-y-6">
              {/* Video grid */}
              <div className="flex flex-wrap justify-center gap-6 p-4">
                {/* Local video */}
                <VideoBubble
                  stream={localStream}
                  label={displayName}
                  muted={true}
                  isLocal={true}
                  hasAudio={hasAudio}
                  hasVideo={hasVideo}
                />

                {/* Remote videos */}
                {otherParticipants.map(participant => {
                  const stream = remoteStreams.get(participant.peerId as PeerID)
                  const state = connectionStates.get(
                    participant.peerId as PeerID,
                  )
                  const presence = allPresence[participant.peerId]

                  return (
                    <div key={participant.peerId} className="relative">
                      <VideoBubble
                        stream={stream || null}
                        label={participant.name}
                        muted={false}
                        isLocal={false}
                        hasAudio={presence?.wantsAudio ?? true}
                        hasVideo={presence?.wantsVideo ?? true}
                      />
                      {/* Connection state indicator */}
                      {state && state !== "connected" && (
                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-500">
                          {state === "connecting" ? "Connecting..." : "Failed"}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Empty state */}
                {otherParticipants.length === 0 && (
                  <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                    <span className="text-4xl mb-2">👋</span>
                    <p>Waiting for others to join...</p>
                    <p className="text-sm mt-1">
                      Share the link to invite participants
                    </p>
                  </div>
                )}
              </div>

              {/* Controls bar */}
              <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
                <div className="max-w-6xl mx-auto flex justify-center gap-4">
                  <button
                    type="button"
                    onClick={toggleAudio}
                    className={`p-4 rounded-full ${
                      hasAudio
                        ? "bg-gray-200 hover:bg-gray-300"
                        : "bg-red-500 text-white hover:bg-red-600"
                    }`}
                    title={hasAudio ? "Mute" : "Unmute"}
                  >
                    {hasAudio ? "🎤" : "🔇"}
                  </button>
                  <button
                    type="button"
                    onClick={toggleVideo}
                    className={`p-4 rounded-full ${
                      hasVideo
                        ? "bg-gray-200 hover:bg-gray-300"
                        : "bg-red-500 text-white hover:bg-red-600"
                    }`}
                    title={hasVideo ? "Turn off camera" : "Turn on camera"}
                  >
                    {hasVideo ? "📷" : "📷"}
                  </button>
                  <button
                    type="button"
                    onClick={leaveRoom}
                    className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600"
                    title="Leave room"
                  >
                    📞
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
