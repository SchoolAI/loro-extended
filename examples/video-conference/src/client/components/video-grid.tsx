import type { PeerID } from "@loro-extended/repo"
import { VideoBubble } from "../video-bubble"
import type { UserPresence } from "../../shared/types"
import type { ConnectionState } from "../hooks/use-peer-manager"

export type Participant = {
  peerId: string
  name: string
  joinedAt: number
}

export type VideoGridProps = {
  localStream: MediaStream | null
  displayName: string
  hasAudio: boolean
  hasVideo: boolean
  otherParticipants: Participant[]
  remoteStreams: Map<PeerID, MediaStream>
  connectionStates: Map<PeerID, ConnectionState>
  userPresence: Record<string, UserPresence>
}

export function VideoGrid({
  localStream,
  displayName,
  hasAudio,
  hasVideo,
  otherParticipants,
  remoteStreams,
  connectionStates,
  userPresence,
}: VideoGridProps) {
  return (
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
        const state = connectionStates.get(participant.peerId as PeerID)
        const presence = userPresence[participant.peerId]

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
          <p className="text-sm mt-1">Share the link to invite participants</p>
        </div>
      )}
    </div>
  )
}