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

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(err => {
        console.warn("Video autoplay failed:", err)
      })
    }
  }, [stream])

  return (
    <div className="relative flex flex-col items-center">
      {/* Video container with circular mask */}
      <div
        className={`relative w-32 h-32 sm:w-40 sm:h-40 rounded-full overflow-hidden shadow-lg ${
          isLocal ? "ring-2 ring-blue-500" : "ring-2 ring-gray-300"
        }`}
      >
        {stream && hasVideo ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={muted || isLocal}
            className="w-full h-full object-cover scale-x-[-1]"
          />
        ) : (
          <div className="w-full h-full bg-gray-700 flex items-center justify-center">
            <span className="text-4xl">👤</span>
          </div>
        )}

        {/* Audio indicator */}
        {!hasAudio && (
          <div className="absolute bottom-2 right-2 bg-red-500 rounded-full p-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-4 h-4 text-white"
            >
              <title>Muted</title>
              <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM17.78 9.22a.75.75 0 10-1.06 1.06L18.44 12l-1.72 1.72a.75.75 0 001.06 1.06l1.72-1.72 1.72 1.72a.75.75 0 101.06-1.06L20.56 12l1.72-1.72a.75.75 0 00-1.06-1.06l-1.72 1.72-1.72-1.72z" />
            </svg>
          </div>
        )}

        {/* Video off indicator */}
        {!hasVideo && (
          <div className="absolute bottom-2 left-2 bg-red-500 rounded-full p-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-4 h-4 text-white"
            >
              <title>Video Off</title>
              <path d="M3.53 2.47a.75.75 0 00-1.06 1.06l18 18a.75.75 0 101.06-1.06l-18-18zM22.5 17.69c0 .471-.202.86-.504 1.124l-4.746-4.746V7.939l2.69-2.689c.944-.945 2.56-.276 2.56 1.06v11.38zM15.75 7.5v5.068L7.682 4.5h5.068a3 3 0 013 3zM1.5 7.5c0-.782.3-1.494.79-2.028l12.846 12.846A2.995 2.995 0 0112.75 19.5H4.5a3 3 0 01-3-3v-9z" />
            </svg>
          </div>
        )}
      </div>

      {/* Label */}
      <div className="mt-2 text-sm font-medium text-gray-700 truncate max-w-[120px]">
        {label}
        {isLocal && " (You)"}
      </div>
    </div>
  )
}