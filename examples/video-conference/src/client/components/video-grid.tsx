import type { PeerID } from "@loro-extended/repo"
import { VideoBubble } from "../video-bubble"
import type { UserPresence } from "../../shared/types"
import type { ParticipantConnectionStatus } from "../hooks/use-connection-status"

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
  userPresence: Record<string, UserPresence>
  getPeerStatus: (peerId: PeerID) => ParticipantConnectionStatus
}

/**
 * Get display text for a peer's connection status.
 */
function getStatusText(status: ParticipantConnectionStatus): string | null {
  switch (status) {
    case "connected":
      return null
    case "reconnecting":
      return "Reconnecting..."
    case "peer-disconnected":
      return "Appears offline"
    case "self-disconnected":
      return "You're offline"
  }
}

/**
 * Get CSS classes for status badge styling.
 */
function getStatusClasses(status: ParticipantConnectionStatus): string {
  switch (status) {
    case "connected":
      return ""
    case "reconnecting":
      return "text-yellow-600"
    case "peer-disconnected":
      return "text-red-500"
    case "self-disconnected":
      return "text-orange-500"
  }
}

export function VideoGrid({
  localStream,
  displayName,
  hasAudio,
  hasVideo,
  otherParticipants,
  remoteStreams,
  userPresence,
  getPeerStatus,
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
        const presence = userPresence[participant.peerId]
        const status = getPeerStatus(participant.peerId as PeerID)
        const statusText = getStatusText(status)
        const statusClasses = getStatusClasses(status)

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
            {/* Connection status indicator */}
            {statusText && (
              <div className={`absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs ${statusClasses}`}>
                {statusText}
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