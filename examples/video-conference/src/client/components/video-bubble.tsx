import { useEffect, useRef } from "react"

export type VideoBubbleProps = {
  stream: MediaStream | null
  label: string
  muted?: boolean
  isLocal?: boolean
  hasAudio?: boolean
  hasVideo?: boolean
}

/**
 * Microphone icon with strikethrough for muted state
 */
function MicOffIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <title>Microphone Off</title>
      {/* Microphone body */}
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
      {/* Microphone stand */}
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
      {/* Diagonal strikethrough */}
      <line
        x1="3"
        y1="3"
        x2="21"
        y2="21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Camera icon with strikethrough for off state
 */
function CameraOffIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <title>Camera Off</title>
      {/* Camera body */}
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
      {/* Diagonal strikethrough */}
      <line
        x1="3"
        y1="3"
        x2="21"
        y2="21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * A circular video bubble component for displaying video streams
 */
export function VideoBubble({
  stream,
  label,
  muted = false,
  isLocal = false,
  hasAudio = true,
  hasVideo = true,
}: VideoBubbleProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Set up video stream - re-run when stream or hasVideo changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasVideo triggers re-play when video is re-enabled
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(err => {
        console.warn("Video autoplay failed:", err)
      })
    }
  }, [stream, hasVideo /* needed to re-trigger play() on re-enable */])

  return (
    <div className="relative flex flex-col items-center">
      {/* Video container with circular mask */}
      <div
        className={`relative w-32 h-32 sm:w-40 sm:h-40 rounded-full overflow-hidden shadow-lg ${
          isLocal ? "ring-2 ring-blue-500" : "ring-2 ring-gray-300"
        }`}
      >
        {/* Always render video element to maintain srcObject, but hide when video is off */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted || isLocal}
          className={`w-full h-full object-cover scale-x-[-1] ${
            stream && hasVideo ? "block" : "hidden"
          }`}
        />
        {/* Show placeholder when video is off or no stream */}
        {(!stream || !hasVideo) && (
          <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
            <span className="text-4xl">👤</span>
          </div>
        )}
      </div>

      {/* Status indicators - positioned absolutely to overlap the bubble bottom edge */}
      {(!hasAudio || !hasVideo) && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-1.5">
          {!hasAudio && (
            <div className="bg-red-500 rounded-full p-1.5 shadow-md">
              <MicOffIcon className="w-3.5 h-3.5 text-white" />
            </div>
          )}
          {!hasVideo && (
            <div className="bg-red-500 rounded-full p-1.5 shadow-md">
              <CameraOffIcon className="w-3.5 h-3.5 text-white" />
            </div>
          )}
        </div>
      )}

      {/* Label */}
      <div className="mt-2 text-sm font-medium text-gray-700 truncate max-w-[120px]">
        {label}
        {isLocal && " (You)"}
      </div>
    </div>
  )
}
