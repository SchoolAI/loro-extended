import type { PeerID } from "@loro-extended/repo"
import type { UserPresence } from "../../shared/types"
import type { ConnectionState } from "../hooks/use-peer-manager"
import type { ParticipantConnectionStatus } from "../hooks/use-connection-status"
import { ControlBar } from "./control-bar"
import { VideoGrid, type Participant } from "./video-grid"

export type InCallScreenProps = {
  localStream: MediaStream | null
  displayName: string
  hasAudio: boolean
  hasVideo: boolean
  otherParticipants: Participant[]
  remoteStreams: Map<PeerID, MediaStream>
  connectionStates: Map<PeerID, ConnectionState>
  userPresence: Record<string, UserPresence>
  getPeerStatus: (peerId: PeerID) => ParticipantConnectionStatus
  onToggleAudio: () => void
  onToggleVideo: () => void
  onLeave: () => void
}

export function InCallScreen({
  localStream,
  displayName,
  hasAudio,
  hasVideo,
  otherParticipants,
  remoteStreams,
  connectionStates: _connectionStates, // Kept for backward compatibility, but getPeerStatus is preferred
  userPresence,
  getPeerStatus,
  onToggleAudio,
  onToggleVideo,
  onLeave,
}: InCallScreenProps) {
  return (
    <div className="space-y-6">
      <VideoGrid
        localStream={localStream}
        displayName={displayName}
        hasAudio={hasAudio}
        hasVideo={hasVideo}
        otherParticipants={otherParticipants}
        remoteStreams={remoteStreams}
        userPresence={userPresence}
        getPeerStatus={getPeerStatus}
      />

      <ControlBar
        hasAudio={hasAudio}
        hasVideo={hasVideo}
        onToggleAudio={onToggleAudio}
        onToggleVideo={onToggleVideo}
        onLeave={onLeave}
      />
    </div>
  )
}