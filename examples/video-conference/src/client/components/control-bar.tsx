export type ControlBarProps = {
  hasAudio: boolean
  hasVideo: boolean
  onToggleAudio: () => void
  onToggleVideo: () => void
  onLeave: () => void
}

export function ControlBar({
  hasAudio,
  hasVideo,
  onToggleAudio,
  onToggleVideo,
  onLeave,
}: ControlBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
      <div className="max-w-6xl mx-auto flex justify-center gap-4">
        <button
          type="button"
          onClick={onToggleAudio}
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
          onClick={onToggleVideo}
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
          onClick={onLeave}
          className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600"
          title="Leave room"
        >
          📞
        </button>
      </div>
    </div>
  )
}