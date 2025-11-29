import { VideoBubble } from "../video-bubble"

export type PreJoinScreenProps = {
  localStream: MediaStream | null
  displayName: string
  hasAudio: boolean
  hasVideo: boolean
  mediaError: Error | null
  mediaLoading: boolean
  onToggleAudio: () => void
  onToggleVideo: () => void
  onRequestMedia: () => void
  onJoin: () => void
  canJoin: boolean
}

export function PreJoinScreen({
  localStream,
  displayName,
  hasAudio,
  hasVideo,
  mediaError,
  mediaLoading,
  onToggleAudio,
  onToggleVideo,
  onRequestMedia,
  onJoin,
  canJoin,
}: PreJoinScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Ready to join?</h2>

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
          <button type="button" onClick={onRequestMedia} className="ml-2 underline">
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
          onClick={onToggleAudio}
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
          onClick={onToggleVideo}
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
        onClick={onJoin}
        disabled={!canJoin}
        className="bg-green-600 hover:bg-green-500 disabled:bg-gray-300 text-white px-8 py-3 rounded-full text-lg font-medium transition-colors shadow-lg"
      >
        Join Room
      </button>

      <p className="text-gray-500 text-sm">
        Share this link with others to invite them
      </p>
    </div>
  )
}